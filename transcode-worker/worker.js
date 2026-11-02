const http = require('http');
const url = require('url');
const { spawn } = require('child_process');

const PORT = 4105;
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'D:\\ffmpeg\\bin\\ffmpeg.exe';
const VIDEO_SHARE_PREFIX = '\\\\192.168.1.242\\e$\\plex\\';

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', worker: 'Pentium Gold UHD 710 QSV', ffmpeg: FFMPEG_PATH }));
  }

  if (parsedUrl.pathname === '/transcode') {
    const file = parsedUrl.query.file;
    const quality = parsedUrl.query.quality || '720p';
    const start = parsedUrl.query.start ? parseFloat(parsedUrl.query.start) : 0;

    if (!file) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      return res.end('Missing file parameter');
    }

    // รองรับทั้ง absolute UNC path หรือ relative path จาก plex
    let inputPath = file;
    if (!inputPath.startsWith('\\\\') && !inputPath.includes(':')) {
      inputPath = VIDEO_SHARE_PREFIX + file.replace(/\//g, '\\');
    }

    // กำหนดค่าบิตเรตและความละเอียดสำหรับ Intel QSV
    let scaleFilter = 'scale_qsv=w=1280:h=-2';
    let videoBitrate = '2200k';
    let audioBitrate = '128k';

    if (quality === '480p') {
      scaleFilter = 'scale_qsv=w=854:h=-2';
      videoBitrate = '900k';
      audioBitrate = '96k';
    } else if (quality === '360p') {
      scaleFilter = 'scale_qsv=w=640:h=-2';
      videoBitrate = '500k';
      audioBitrate = '64k';
    }

    console.log(`[QSV WORKER] Transcoding with Intel UHD 710: ${quality} -> ${inputPath}`);

    const ffmpegArgs = [];

    // Seeking (ถ้ามีระบุเวลาเริ่มต้น)
    if (start > 0) {
      ffmpegArgs.push('-ss', start.toString());
    }

    // ใช้ Intel QuickSync ฮาร์ดแวร์เร่งความเร็ว
    ffmpegArgs.push(
      '-hwaccel', 'qsv',
      '-hwaccel_output_format', 'qsv',
      '-i', inputPath,
      '-vf', scaleFilter,
      '-c:v', 'h264_qsv',
      '-preset', 'veryfast',
      '-b:v', videoBitrate,
      '-maxrate', videoBitrate,
      '-bufsize', '4000k',
      '-c:a', 'aac',
      '-b:a', audioBitrate,
      '-ac', '2',
      '-f', 'mp4',
      '-movflags', 'frag_keyframe+empty_moov+default_base_moof',
      'pipe:1'
    );

    res.writeHead(200, {
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
    });

    const ffmpeg = spawn(FFMPEG_PATH, ffmpegArgs);

    ffmpeg.stdout.pipe(res);

    ffmpeg.stderr.on('data', (data) => {
      // สามารถเปิดดู log ได้หากต้องการดีบัก
      // console.log(`ffmpeg: ${data}`);
    });

    ffmpeg.on('close', (code) => {
      console.log(`[QSV WORKER] Stream finished with exit code ${code}`);
    });

    ffmpeg.on('error', (err) => {
      console.error('[QSV WORKER ERROR]', err);
    });

    req.on('close', () => {
      // เมื่อผู้ใช้หยุดดูหรือปิดแท็บ สั่งฆ่า FFmpeg ทันทีเพื่อประหยัดทรัพยากร
      ffmpeg.kill('SIGTERM');
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(` Intel QSV Transcode Worker is running on port ${PORT}`);
  console.log(` FFmpeg Path: ${FFMPEG_PATH}`);
  console.log(` Video Source: ${VIDEO_SHARE_PREFIX}`);
  console.log(`=======================================================`);
});
