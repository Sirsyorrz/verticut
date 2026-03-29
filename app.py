from flask import Flask, request, jsonify, send_file, send_from_directory
from flask_cors import CORS
import subprocess
import os
import json
import uuid
import threading

app = Flask(__name__, static_folder='static')
CORS(app)

UPLOAD_FOLDER = 'uploads'
OUTPUT_FOLDER = 'outputs'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_FOLDER, exist_ok=True)

# job_id -> { status, progress_file, output_file, error }
jobs = {}


def get_video_info(filepath):
    cmd = [
        'ffprobe', '-v', 'quiet', '-print_format', 'json',
        '-show_streams', '-show_format', filepath
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    data = json.loads(result.stdout)
    video_stream = next(
        (s for s in data['streams'] if s['codec_type'] == 'video'), None
    )
    duration = float(data['format'].get('duration', 0))
    return {
        'width': video_stream['width'],
        'height': video_stream['height'],
        'duration': duration,
        'fps': eval(video_stream.get('r_frame_rate', '30/1'))
    }


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')


@app.route('/upload', methods=['POST'])
def upload_video():
    if 'video' not in request.files:
        return jsonify({'error': 'No video file'}), 400
    file = request.files['video']
    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename)[1].lower() or '.mp4'
    filename = f"{file_id}{ext}"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    file.save(filepath)
    info = get_video_info(filepath)
    return jsonify({
        'file_id': file_id,
        'filename': filename,
        'width': info['width'],
        'height': info['height'],
        'duration': info['duration'],
        'fps': info['fps']
    })


@app.route('/preview_frame', methods=['POST'])
def preview_frame():
    data = request.json
    filename = data['filename']
    timestamp = data.get('timestamp', 0)
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    frame_id = str(uuid.uuid4())
    frame_path = os.path.join(OUTPUT_FOLDER, f"frame_{frame_id}.jpg")
    cmd = [
        'ffmpeg', '-ss', str(timestamp), '-i', filepath,
        '-vframes', '1', '-q:v', '2', '-y', frame_path
    ]
    subprocess.run(cmd, capture_output=True)
    return send_file(frame_path, mimetype='image/jpeg')


@app.route('/process', methods=['POST'])
def process_video():
    """
    Starts FFmpeg in a background thread and returns a job_id immediately.
    Poll /progress/<job_id> to track progress.
    """
    data = request.json
    filename = data['filename']
    zones = data['zones']
    output_width = int(data.get('output_width', 1080))
    output_height = int(data.get('output_height', 1920))
    output_fps = int(data.get('output_fps', 60))
    trim_start = data.get('trim_start', 0)
    trim_end = data.get('trim_end', None)

    filepath = os.path.join(UPLOAD_FOLDER, filename)
    if not os.path.exists(filepath):
        return jsonify({'error': 'Source video not found'}), 404

    info = get_video_info(filepath)
    if trim_end:
        out_duration = trim_end - trim_start
    elif trim_start > 0:
        out_duration = info['duration'] - trim_start
    else:
        out_duration = info['duration']

    out_id = str(uuid.uuid4())
    output_file = f"output_{out_id}.mp4"
    output_path = os.path.join(OUTPUT_FOLDER, output_file)
    # Use forward slashes so FFmpeg handles the path on Windows
    progress_path = os.path.join(OUTPUT_FOLDER, f"progress_{out_id}.txt").replace('\\', '/')

    # Validate zone dimensions
    for i, zone in enumerate(zones):
        if int(zone.get('src_w', 0)) <= 0 or int(zone.get('src_h', 0)) <= 0:
            return jsonify({'error': f'Zone {i+1} has zero source dimensions'}), 400
        if int(zone.get('dst_w', 0)) <= 0 or int(zone.get('dst_h', 0)) <= 0:
            return jsonify({'error': f'Zone {i+1} has zero destination dimensions'}), 400

    trim_filter = ''
    if trim_end:
        trim_filter = f"trim=start={trim_start}:end={trim_end},setpts=PTS-STARTPTS,"
    elif trim_start > 0:
        trim_filter = f"trim=start={trim_start},setpts=PTS-STARTPTS,"

    filter_parts = []

    # Black canvas
    filter_parts.append(
        f"color=black:s={output_width}x{output_height}:r={output_fps}[canvas]"
    )

    # Compute padding needed for any out-of-bounds SRC crops (letterboxing)
    vid_w, vid_h = info['width'], info['height']
    pad_l = max(0, -min(int(z['src_x']) for z in zones))
    pad_t = max(0, -min(int(z['src_y']) for z in zones))
    pad_r = max(0, max(int(z['src_x']) + int(z['src_w']) for z in zones) - vid_w)
    pad_b = max(0, max(int(z['src_y']) + int(z['src_h']) for z in zones) - vid_h)
    padded_w = vid_w + pad_l + pad_r
    padded_h = vid_h + pad_t + pad_b
    pad_filter = f"pad={padded_w}:{padded_h}:{pad_l}:{pad_t}," if (pad_l or pad_t or pad_r or pad_b) else ""

    # Crop + scale each zone
    for i, zone in enumerate(zones):
        sx = int(zone['src_x']) + pad_l
        sy = int(zone['src_y']) + pad_t
        sw, sh = int(zone['src_w']), int(zone['src_h'])
        dw, dh = int(zone['dst_w']), int(zone['dst_h'])
        filter_parts.append(
            f"[0:v]{trim_filter}{pad_filter}crop={sw}:{sh}:{sx}:{sy},"
            f"scale={dw}:{dh}[z{i}]"
        )

    # Overlay zones onto canvas
    prev = 'canvas'
    for i, zone in enumerate(zones):
        dx, dy = int(zone['dst_x']), int(zone['dst_y'])
        nxt = f"ov{i}" if i < len(zones) - 1 else "out"
        # shortest=1: stop when the video zone ends, not when the infinite canvas ends
        filter_parts.append(f"[{prev}][z{i}]overlay={dx}:{dy}:shortest=1[{nxt}]")
        prev = nxt

    filter_complex = ';'.join(filter_parts)

    cmd = [
        'ffmpeg', '-i', filepath,
        '-filter_complex', filter_complex,
        '-map', '[out]',
        '-map', '0:a?',
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        '-c:a', 'aac', '-b:a', '192k',
        '-r', str(output_fps),
        '-t', str(out_duration),
        '-progress', progress_path,
        '-stats_period', '0.5',
        '-loglevel', 'error',
        '-y', output_path
    ]

    job_id = str(uuid.uuid4())
    jobs[job_id] = {
        'status': 'running',
        'progress_path': progress_path,
        'output_file': output_file,
        'error': None
    }

    def run_ffmpeg():
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            jobs[job_id]['status'] = 'done'
        else:
            jobs[job_id]['status'] = 'error'
            jobs[job_id]['error'] = result.stderr or result.stdout
        try:
            os.remove(progress_path)
        except Exception:
            pass

    thread = threading.Thread(target=run_ffmpeg, daemon=True)
    thread.start()

    return jsonify({'job_id': job_id, 'output_file': output_file})


@app.route('/progress/<job_id>')
def get_progress(job_id):
    job = jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404

    if job['status'] == 'done':
        return jsonify({
            'status': 'done',
            'output_file': job['output_file'],
            'download_url': f"/download/{job['output_file']}"
        })

    if job['status'] == 'error':
        return jsonify({'status': 'error', 'error': job.get('error', 'Unknown FFmpeg error')})

    # Parse latest values from progress file
    out_time_ms = 0
    speed = ''
    fps = ''
    try:
        with open(job['progress_path'], 'r') as f:
            for line in f:
                line = line.strip()
                if line.startswith('out_time_ms='):
                    val = line.split('=', 1)[1]
                    if val and val != 'N/A':
                        try:
                            out_time_ms = int(val)
                        except ValueError:
                            pass
                elif line.startswith('speed='):
                    speed = line.split('=', 1)[1].strip()
                elif line.startswith('fps='):
                    fps = line.split('=', 1)[1].strip()
    except Exception:
        pass

    return jsonify({
        'status': 'running',
        'out_time_ms': out_time_ms,
        'speed': speed,
        'fps': fps
    })


@app.route('/download/<filename>')
def download(filename):
    filepath = os.path.join(OUTPUT_FOLDER, filename)
    return send_file(filepath, as_attachment=True, download_name=filename)


@app.route('/video/<filename>')
def serve_video(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


if __name__ == '__main__':
    print("VertiCut running at http://localhost:5000")
    app.run(debug=True, port=5000)
