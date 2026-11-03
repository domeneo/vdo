const http = require('http');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const PORT = 4105;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'D:\\ffmpeg\\bin\\ffprobe.exe';
const VIDEO_SHARE_PREFIX = '\\\\192.168.1.242\\plex$\\';

console.log('Checking binaries...');
console.log('FFmpeg exists:', fs.existsSync(FFMPEG_PATH), `(${FFMPEG_PATH})`);
console.log('FFprobe exists:', fs.existsSync(FFPROBE_PATH), `(${FFPROBE_PATH})`);

// Duration Cache
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
  const reqUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS headers
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
    const sub = reqUrl.searchParams.get('sub') || '';
    const audio = reqUrl.searchParams.get('audio') || '';

    console.log(`[REQUEST M3U8] File: ${file}, Quality: ${quality}, Sub: ${sub || 'none'}, Audio: ${audio || 'default'}`);

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

    const subParam = sub ? `&sub=${encodeURIComponent(sub)}` : '';
    const audioParam = audio ? `&audio=${encodeURIComponent(audio)}` : '';

    for (let i = 0; i < totalSegments; i++) {
      const segStart = i * SEG_DURATION;
      const thisDuration = Math.min(SEG_DURATION, duration - segStart);
      if (i > 0) {
        m3u8 += `#EXT-X-DISCONTINUITY\n`;
      }
      m3u8 += `#EXTINF:${thisDuration.toFixed(3)},\n`;
      m3u8 += `segment.ts?file=${encodeURIComponent(file)}&quality=${quality}${subParam}${audioParam}&index=${i}&start=${segStart}&duration=${thisDuration}\n`;
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
    const sub = reqUrl.searchParams.get('sub') || '';
    const audio = reqUrl.searchParams.get('audio') || '';
    const start = parseFloat(reqUrl.searchParams.get('start') || '0');
    const segDuration = parseFloat(reqUrl.searchParams.get('duration') || '4');
    const index = reqUrl.searchParams.get('index') || '0';

    console.log(`[REQUEST SEGMENT] #${index} at ${start}s (${segDuration}s) [${quality}] sub=${sub || 'none'} audio=${audio || 'default'}`);

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
    let videoBitrate = '2000k';
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

    let ffmpegArgs = [
      '-ss', start.toString(),
      '-i', inputPath,
      '-t', segDuration.toString(),
    ];

    if (sub && sub !== 'none') {
      // Burn-in Subtitle (PGS หรือ DVD Subtitle)
      // เติม pad แถบดำ 16:9 ให้ตรงกับพิกัด Canvas ของแผ่น BluRay/DVD ต้นฉบับ
      // แล้วแปะ overlay ซับ จากนั้นย่อลงความละเอียดเป้าหมาย (720p/480p)
      ffmpegArgs.push(
        '-filter_complex',
        `[0:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v];[v][0:${sub}]overlay,scale=${targetWidth}:${targetHeight},format=nv12`
      );
    } else {
      ffmpegArgs.push(
        '-map', '0:v:0',
        '-vf', `scale=${targetWidth}:${targetHeight},format=nv12`
      );
    }

    // เลือกระบบเสียง (Audio Track) ตามที่ผู้ใช้เลือก
    if (audio && audio !== 'default') {
      ffmpegArgs.push('-map', `0:${audio}`);
    } else {
      ffmpegArgs.push('-map', '0:a:0?');
    }

    ffmpegArgs.push(
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
    );

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (d) => {
      const s = d.toString();
      if (s.includes('Error') || s.includes('failed') || s.includes('Invalid') || s.includes('Could not')) {
        console.error(`[SEGMENT ERROR #${index}]:`, s.trim());
      }
    });

    ffmpeg.on('close', (code) => {
      if (code !== 0 && code !== null) {
        console.log(`[SEGMENT #${index} EXITED]: code ${code}`);
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
