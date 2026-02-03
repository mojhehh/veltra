#!/usr/bin/env python3
"""
Song Downloader - Download songs by name from YouTube Music or Spotify
Uses yt-dlp and spotdl for reliable downloads with good audio quality
Also fetches cover art, metadata, and URLs
"""

import subprocess
import sys
import os
import json
import urllib.request
import re
import time
import traceback

# Enable verbose logging
VERBOSE = True

def log(msg, level="INFO"):
    """Log with timestamp"""
    timestamp = time.strftime("%H:%M:%S")
    print(f"[{timestamp}] [{level}] {msg}")

def log_error(msg, exc=None):
    """Log error with full traceback"""
    log(msg, "ERROR")
    if exc:
        log(f"Exception: {type(exc).__name__}: {exc}", "ERROR")
        if VERBOSE:
            traceback.print_exc()

def get_yt_dlp_cmd():
    """Get the yt-dlp command (works on Windows with pip install)"""
    # Try running as module first (most reliable on Windows)
    return [sys.executable, "-m", "yt_dlp"]

def check_yt_dlp():
    """Check if yt-dlp is installed"""
    try:
        subprocess.run(get_yt_dlp_cmd() + ["--version"], capture_output=True, check=True)
        return True
    except (subprocess.CalledProcessError, FileNotFoundError):
        return False

def install_yt_dlp():
    """Install yt-dlp via pip"""
    print("Installing yt-dlp...")
    subprocess.run([sys.executable, "-m", "pip", "install", "-U", "yt-dlp"], check=True)

def download_song(query, output_dir="downloads"):
    """
    Download a song by search query
    
    Args:
        query: Song name (e.g., "Never Gonna Give You Up Rick Astley")
        output_dir: Directory to save downloads
    """
    # Create output directory
    os.makedirs(output_dir, exist_ok=True)
    
    # Output template with metadata
    output_template = os.path.join(output_dir, "%(artist)s - %(title)s.%(ext)s")
    
    # yt-dlp command for best audio quality
    cmd = get_yt_dlp_cmd() + [
        f"ytsearch1:{query}",  # Search YouTube, take first result
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",  # Best quality
        "--embed-thumbnail",
        "--embed-metadata",
        "--output", output_template,
        "--no-playlist",
        "--progress"
    ]
    
    print(f"🔍 Searching for: {query}")
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode == 0:
            print(f"✅ Downloaded successfully to '{output_dir}/'")
            return True
        else:
            print(f"❌ Error: {result.stderr}")
            return False
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

def download_from_spotify_url(spotify_url, output_dir="downloads", timeout=120):
    """
    Download from Spotify URL using spotdl, falls back to yt-dlp search
    Returns dict with file path, cover art, and metadata
    """
    os.makedirs(output_dir, exist_ok=True)
    
    log(f"🎵 Starting Spotify download: {spotify_url}")
    start_time = time.time()
    
    try:
        # Use spotdl to download
        cmd = [
            sys.executable, "-m", "spotdl",
            spotify_url,
            "--output", output_dir,
            "--format", "mp3",
            "--bitrate", "320k",
        ]
        
        log(f"Running command: {' '.join(cmd)}")
        
        # Run with timeout and real-time output
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            bufsize=1,
            errors='replace'  # Handle encoding issues
        )
        
        output_lines = []
        rate_limited = False
        
        while True:
            # Check timeout
            elapsed = time.time() - start_time
            if elapsed > timeout:
                process.kill()
                log_error(f"❌ TIMEOUT after {elapsed:.1f}s! Killed process.")
                break
            
            line = process.stdout.readline()
            if not line and process.poll() is not None:
                break
            if line:
                line = line.strip()
                output_lines.append(line)
                log(f"  spotdl: {line}")
                
                # Check for rate limiting
                if "rate" in line.lower() and "limit" in line.lower():
                    rate_limited = True
                    log("⚠️ Rate limited detected! Will try yt-dlp fallback...")
                    process.kill()
                    break
        
        returncode = process.poll() or process.wait()
        elapsed = time.time() - start_time
        
        # If rate limited, try yt-dlp fallback
        if rate_limited:
            log("🔄 Falling back to yt-dlp search...")
            # Extract track ID and search on YouTube
            track_name = extract_spotify_track_name(spotify_url)
            if track_name:
                return download_song_with_metadata(track_name, output_dir)
            else:
                log_error("Could not extract track name for fallback")
                return False
        
        log(f"Process finished in {elapsed:.1f}s with code {returncode}")
        
        if returncode == 0:
            log(f"✅ Downloaded successfully to '{output_dir}/'")
            return True
        else:
            log_error(f"spotdl exited with code {returncode}")
            log_error(f"Full output:\n" + "\n".join(output_lines))
            return False
            
    except Exception as e:
        elapsed = time.time() - start_time
        log_error(f"❌ Exception after {elapsed:.1f}s", e)
        return False


def extract_spotify_track_name(spotify_url):
    """
    Try to get track name from Spotify URL using web scraping or API
    Falls back to just returning the track ID
    """
    try:
        # Try to fetch the page and extract title
        import urllib.request
        
        log(f"Fetching Spotify page for track info...")
        
        req = urllib.request.Request(
            spotify_url,
            headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        )
        
        with urllib.request.urlopen(req, timeout=10) as response:
            html = response.read().decode('utf-8', errors='replace')
            
            # Look for title in meta tags
            # <meta property="og:title" content="Song Name">
            import re
            match = re.search(r'<meta property="og:title" content="([^"]+)"', html)
            if match:
                title = match.group(1)
                log(f"Found track: {title}")
                return title
            
            # Try twitter:title
            match = re.search(r'<meta name="twitter:title" content="([^"]+)"', html)
            if match:
                title = match.group(1)
                log(f"Found track: {title}")
                return title
            
            # Try <title> tag
            match = re.search(r'<title>([^<]+)</title>', html)
            if match:
                title = match.group(1).replace(' | Spotify', '').strip()
                log(f"Found track from title: {title}")
                return title
                
    except Exception as e:
        log_error(f"Could not fetch Spotify page", e)
    
    return None


def get_spotify_track_info(spotify_url):
    """
    Get track metadata from Spotify URL using spotdl
    Returns dict with title, artist, album, cover_url, duration, etc.
    """
    try:
        cmd = [
            sys.executable, "-m", "spotdl",
            "--print-errors",
            "url", spotify_url
        ]
        
        result = subprocess.run(cmd, capture_output=True, text=True)
        
        # Parse the output for metadata
        # spotdl outputs JSON-like data
        return {"raw_output": result.stdout, "url": spotify_url}
        
    except Exception as e:
        print(f"Error getting track info: {e}")
        return None


def download_song_with_metadata(query, output_dir="downloads"):
    """
    Download a song and return full metadata including cover art URL
    
    Returns dict with:
        - file_path: path to downloaded mp3
        - title: song title
        - artist: artist name
        - thumbnail_url: cover art URL
        - duration: length in seconds
        - youtube_url: source URL
    """
    os.makedirs(output_dir, exist_ok=True)
    
    print(f"🔍 Searching for: {query}")
    
    # First, get metadata without downloading
    info_cmd = get_yt_dlp_cmd() + [
        f"ytsearch1:{query}",
        "--dump-json",
        "--no-download"
    ]
    
    try:
        result = subprocess.run(info_cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"❌ Search failed")
            return None
            
        info = json.loads(result.stdout)
        
        metadata = {
            "title": info.get("title", "Unknown"),
            "artist": info.get("artist") or info.get("uploader", "Unknown"),
            "album": info.get("album", ""),
            "duration": info.get("duration", 0),
            "youtube_url": info.get("webpage_url", ""),
            "thumbnail_url": info.get("thumbnail", ""),
            "thumbnails": info.get("thumbnails", []),  # All available sizes
        }
        
        # Get the best thumbnail
        if metadata["thumbnails"]:
            # Sort by resolution, get highest
            best = max(metadata["thumbnails"], key=lambda x: x.get("height", 0) * x.get("width", 0))
            metadata["thumbnail_url"] = best.get("url", metadata["thumbnail_url"])
        
        print(f"📀 Found: {metadata['artist']} - {metadata['title']}")
        print(f"🖼️  Cover: {metadata['thumbnail_url']}")
        print(f"🔗 URL: {metadata['youtube_url']}")
        
        # Now download the actual audio
        safe_filename = re.sub(r'[<>:"/\\|?*]', '_', f"{metadata['artist']} - {metadata['title']}")
        output_path = os.path.join(output_dir, f"{safe_filename}.mp3")
        cover_path = os.path.join(output_dir, f"{safe_filename}.jpg")
        
        download_cmd = get_yt_dlp_cmd() + [
            info["webpage_url"],
            "--extract-audio",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--embed-metadata",
            "--output", output_path.replace(".mp3", ".%(ext)s"),
            "--no-playlist"
        ]
        
        subprocess.run(download_cmd, capture_output=True)
        
        # Also download cover art separately as image file
        if metadata["thumbnail_url"]:
            try:
                urllib.request.urlretrieve(metadata["thumbnail_url"], cover_path)
                metadata["cover_path"] = cover_path
                print(f"🖼️  Saved cover: {cover_path}")
            except Exception as e:
                print(f"⚠️  Could not save cover: {e}")
        
        metadata["file_path"] = output_path
        print(f"✅ Downloaded: {output_path}")
        
        return metadata
        
    except json.JSONDecodeError:
        print("❌ Failed to parse track info")
        return None
    except Exception as e:
        print(f"❌ Error: {e}")
        return None

def main():
    # Check/install yt-dlp
    if not check_yt_dlp():
        print("yt-dlp not found, installing...")
        install_yt_dlp()
    
    print("=" * 50)
    print("🎵 Song Downloader")
    print("=" * 50)
    print("\nCommands:")
    print("  - Type a song name to download")
    print("  - Paste a Spotify URL (requires spotdl)")
    print("  - Type 'quit' to exit")
    print()
    
    while True:
        query = input("Enter song name (or 'quit'): ").strip()
        
        if query.lower() in ['quit', 'exit', 'q']:
            print("Goodbye!")
            break
        
        if not query:
            continue
        
        if "spotify.com" in query:
            download_from_spotify_url(query)
        else:
            download_song(query)
        
        print()

if __name__ == "__main__":
    main()
