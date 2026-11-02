const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const PORT = 4105;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'D:\\ffmpeg\\bin\\ffprobe.exe';
const VIDEO_SHARE_PREFIX = '\\\\192.168.1.242\\plex$\\';

// ตรวจสอบไฟล์ FFmpeg และ FFprobe ตั้งแต่เริ่มเปิดโปรแกรม
console.log('Checking binaries...');
console.log('FFmpeg exists:', fs.existsSync(FFMPEG_PATH), `(${FFMPEG_PATH})`);
console.log('FFprobe exists:', fs.existsSync(FFPROBE_PATH), `(${FFPROBE_PATH})`);

// แคชเก็บ duration
const durationCache = {};

function getDuration(filePath) {
  return new Promise((resolve) => {
    if (durationCache[filePath]) {
      return resolve(durationCache[filePath]);
    }

    console.log(`[PROBING DURATION] Probing: ${filePath}`);
    execFile(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      (err, stdout, stderr) => {
        if (err) {
          console.error(`[PROBE ERROR] Failed to probe duration:`, err.message);
          if (stderr) console.error(`[PROBE STDERR]:`, stderr);
          // Fallback เป็นความยาวเริ่มต้น 1 ชั่วโมง 15 นาที เพื่อให้เปิดดูและเลื่อนได้แน่นอน
          return resolve(4500);
        }
        const dur = parseFloat(stdout.trim());
        if (!isNaN(dur) && dur > 0) {
          console.log(`[PROBE SUCCESS] Duration: ${dur} seconds (${(dur / 60).toFixed(1)} mins)`);
          durationCache[filePath] = dur;
          return resolve(dur);
        }
        resolve(4500);
      }
    );
  });
}

const server = http.createServer(async (req, res) => {
  // ใช้ WHATWG URL API มาตรฐานใหม่ ตัด Warning ออก
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // ตั้งค่า CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (reqUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', worker: 'Intel QSV HLS Engine', ffmpeg: FFMPEG_PATH }));
  }

  // 1. ส่ง HLS Playlist (.m3u8)
  if (reqUrl.pathname === '/hls/playlist.m3u8') {
    const file = reqUrl.searchParams.get('file');
    const quality = reqUrl.searchParams.get('quality') || '720p';

    console.log(`[REQUEST M3U8] File: ${file}, Quality: ${quality}`);

    if (!file) {
      res.writeHead(400);
      return res.end('Missing file');
    }

    let inputPath = file;
    if (!inputPath.startsWith('\\\\') && !inputPath.includes(':')) {
      inputPath = VIDEO_SHARE_PREFIX + file.replace(/\//g, '\\');
    }

    const duration = await getDuration(inputPath);
    const SEG_DURATION = 4; // 4 วินาทีต่อ segment
    const totalSegments = Math.ceil(duration / SEG_DURATION);

    let m3u8 = `#EXTM3U\n`;
    m3u8 += `#EXT-X-VERSION:3\n`;
    m3u8 += `#EXT-X-TARGETDURATION:${SEG_DURATION + 1}\n`;
    m3u8 += `#EXT-X-MEDIA-SEQUENCE:0\n`;
    m3u8 += `#EXT-X-PLAYLIST-TYPE:VOD\n`;

    for (let i = 0; i < totalSegments; i++) {
      const segStart = i * SEG_DURATION;
      const thisDuration = Math.min(SEG_DURATION, duration - segStart);
      m3u8 += `#EXTINF:${thisDuration.toFixed(3)},\n`;
      // ใช้ relative filename เพื่อให้ Hls.js ต่อ URL เดียวกับ playlist เสมอ ไม่หลุดโดเมน
      m3u8 += `segment.ts?file=${encodeURIComponent(file)}&quality=${quality}&index=${i}&start=${segStart}&duration=${thisDuration}\n`;
    }

    m3u8 += `#EXT-X-ENDLIST\n`;

    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    });
    console.log(`[SERVED M3U8] Generated ${totalSegments} segments for ${duration}s video`);
    return res.end(m3u8);
  }

  // 2. แปลงแต่ละ Segment (.ts) แบบ On-Demand ด้วย Intel UHD 710 QSV
  if (reqUrl.pathname === '/hls/segment.ts') {
    const file = reqUrl.searchParams.get('file');
    const quality = reqUrl.searchParams.get('quality') || '720p';
    const start = parseFloat(reqUrl.searchParams.get('start') || '0');
    const segDuration = parseFloat(reqUrl.searchParams.get('duration') || '4');
    const index = reqUrl.searchParams.get('index') || '0';

    console.log(`[REQUEST SEGMENT] #${index} at ${start}s (${segDuration}s) [${quality}]`);

    if (!file) {
      res.writeHead(400);
      return res.end('Missing file');
    }

    let inputPath = file;
    if (!inputPath.startsWith('\\\\') && !inputPath.includes(':')) {
      inputPath = VIDEO_SHARE_PREFIX + file.replace(/\//g, '\\');
    }

    let targetWidth = 1280;
    let targetHeight = 720;
    let videoBitrate = '2200k';
    let audioBitrate = '128k';

    if (quality === '480p') {
      targetWidth = 854;
      targetHeight = 480;
      videoBitrate = '900k';
      audioBitrate = '96k';
    } else if (quality === '360p') {
      targetWidth = 640;
      targetHeight = 360;
      videoBitrate = '500k';
      audioBitrate = '64k';
    }

    res.writeHead(200, {
      'Content-Type': 'video/mp2t',
      'Cache-Control': 'public, max-age=86400',
    });

    // FFmpeg Fast Hardware Segment ตัดแปลงด้วย Intel QSV
    const ffmpegArgs = [
      '-ss', start.toString(),
      '-init_hw_device', 'qsv=hw',
      '-filter_hw_device', 'hw',
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', inputPath,
      '-t', segDuration.toString(),
      '-vf', `vpp_qsv=w=${targetWidth}:h=${targetHeight}`,
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      '-b:v', videoBitrate,
      '-maxrate', videoBitrate,
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ac', '2',
      '-f', 'mpegts',
      '-muxdelay', '0',
      'pipe:1'
    ];

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (d) => {
      // แสดงเฉพาะถ้ามี error
      const s = d.toString();
      if (s.includes('Error') || s.includes('failed') || s.includes('Invalid')) {
        console.error(`[SEGMENT ERROR ${index}]:`, s);
      }
    });

    req.on('close', () => {
      ffmpeg.kill('SIGTERM');
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` Intel QSV HLS Engine is running on port ${PORT}`);
  console.log(` Video Source: ${VIDEO_SHARE_PREFIX}`);
  console.log(` Ready to serve fast hardware segments!`);
  console.log(`=======================================================`);
});
