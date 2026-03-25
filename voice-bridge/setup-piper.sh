#!/bin/bash
set -e

# Only run on Linux (Render deploy) — skip on Windows/Mac dev machines
if [ "$(uname)" != "Linux" ]; then
  echo "==> Skipping Piper setup (not Linux)"
  exit 0
fi

PIPER_VERSION="2023.11.14-2"
VOICE="en_US-lessac-medium"

echo "==> Setting up Piper TTS..."
echo "==> Working directory: $(pwd)"

# Download piper binary (Linux amd64)
if [ ! -f "piper/piper" ]; then
  echo "==> Downloading Piper binary..."
  curl -fSL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" -o piper.tar.gz
  echo "==> Downloaded tarball: $(ls -la piper.tar.gz)"
  tar -xzf piper.tar.gz
  rm piper.tar.gz
  chmod +x piper/piper
  echo "==> Piper binary installed"
else
  echo "==> Piper binary already exists"
fi

# Verify binary exists
if [ ! -f "piper/piper" ]; then
  echo "ERROR: piper/piper not found after extraction!"
  echo "Contents of current directory:"
  ls -la
  exit 1
fi

# Download voice model
mkdir -p voices
if [ ! -f "voices/${VOICE}.onnx" ]; then
  echo "==> Downloading voice model: ${VOICE}..."
  curl -fSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${VOICE}.onnx" -o "voices/${VOICE}.onnx"
  curl -fSL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${VOICE}.onnx.json" -o "voices/${VOICE}.onnx.json"
  echo "==> Voice model downloaded"
else
  echo "==> Voice model already exists"
fi

echo "==> Piper TTS setup complete"
ls -la piper/piper voices/
echo "==> Piper binary size: $(du -h piper/piper | cut -f1)"
