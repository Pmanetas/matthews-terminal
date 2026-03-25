#!/bin/bash
set -e

PIPER_VERSION="2023.11.14-2"
VOICE="en_US-lessac-medium"

echo "==> Setting up Piper TTS..."

# Download piper binary (Linux amd64)
if [ ! -f "piper/piper" ]; then
  echo "==> Downloading Piper binary..."
  curl -sL "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz" -o piper.tar.gz
  tar -xzf piper.tar.gz
  rm piper.tar.gz
  chmod +x piper/piper
fi

# Download voice model
mkdir -p voices
if [ ! -f "voices/${VOICE}.onnx" ]; then
  echo "==> Downloading voice model: ${VOICE}..."
  curl -sL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${VOICE}.onnx" -o "voices/${VOICE}.onnx"
  curl -sL "https://huggingface.co/rhasspy/piper-voices/resolve/main/en/en_US/lessac/medium/${VOICE}.onnx.json" -o "voices/${VOICE}.onnx.json"
fi

echo "==> Piper TTS setup complete"
ls -la piper/piper voices/
