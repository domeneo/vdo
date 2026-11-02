const http = require('http');
const url = require('url');
const path = require('path');
const fs = require('fs');
const { spawn, execFile } = require('child_process');

const PORT = 4105;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const FFPROBE_PATH = process.env.FFPROBE_PATH || 'D:\\ffmpeg\\bin\\ffprobe.exe';
const VIDEO_SHARE_PREFIX = '\\\\192.168.1.242\\plex$\\';
const CACHE_DIR = path.join(__dirname, 'cache_hls');

if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// แคชเก็บ duration ของแต่ละไฟล์
const durationCache = {};

function getDuration(filePath) {
  return new Promise((resolve) => {
    if (durationCache[filePath]) {
      return resolve(durationCache[filePath]);
    }
    execFile(
      FFPROBE_PATH,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      (err, stdout) => {
        if (!err && stdout) {
          const dur = parseFloat(stdout.trim());
          if (!isNaN(dur) && dur > 0) {
            durationCache[filePath] = dur;
            return resolve(dur);
          }
        }
        resolve(3600); // fallback 1 hour
      }
    );
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', '*');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', worker: 'Intel QSV HLS Engine', ffmpeg: FFMPEG_PATH }));
  }

  // 1. ส่ง HLS Playlist (.m3u8) ที่คำนวณความยาวจริงของคลิป 1 ชั่วโมงเต็ม
  if (parsedUrl.pathname === '/hls/playlist.m3u8') {
    const file = parsedUrl.query.file;
    const quality = parsedUrl.query.quality || '720p';

    if (!file) {
      res.writeHead(400);
      return res.end('Missing file');
    }

    let inputPath = file;
    if (!inputPath.startsWith('\\\\') && !inputPath.includes(':')) {
      inputPath = VIDEO_SHARE_PREFIX + file.replace(/\//g, '\\');
    }

    const duration = await getDuration(inputPath);
    const SEG_DURATION = 4; // แต่ละ segment ยาว 4 วินาที
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
      m3u8 += `segment.ts?file=${encodeURIComponent(file)}&quality=${quality}&index=${i}&start=${segStart}&duration=${thisDuration}\n`;
    }

    m3u8 += `#EXT-X-ENDLIST\n`;

    res.writeHead(200, {
      'Content-Type': 'application/vnd.apple.mpegurl',
      'Cache-Control': 'no-cache',
    });
    return res.end(m3u8);
  }

  // 2. แปลงแต่ละ Segment (.ts) แบบ On-Demand ด้วย Intel UHD 710 QSV
  if (parsedUrl.pathname === '/hls/segment.ts') {
    const file = parsedUrl.query.file;
    const quality = parsedUrl.query.quality || '720p';
    const start = parseFloat(parsedUrl.query.start || '0');
    const segDuration = parseFloat(parsedUrl.query.duration || '4');

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

    // ใช้ Intel QSV แปลงเฉพาะ 4 วินาทีนี้ (เสร็จใน ~0.1 - 0.2 วินาที)
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
      'pipe:1'
    ];

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);
    ffmpeg.stdout.pipe(res);

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
  console.log(` FFmpeg: ${FFMPEG_PATH}`);
  console.log(` FFprobe: ${FFPROBE_PATH}`);
  console.log(` Video Source: ${VIDEO_SHARE_PREFIX}`);
  console.log(`=======================================================`);
});
