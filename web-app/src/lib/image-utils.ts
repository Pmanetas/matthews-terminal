const MAX_DIMENSION = 1920
const JPEG_QUALITY = 0.85
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024 // 5MB

export async function resizeImage(file: File): Promise<{ data: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        let { width, height } = img
        // Scale down if too large
        if (width > MAX_DIMENSION || height > MAX_DIMENSION) {
          const ratio = Math.min(MAX_DIMENSION / width, MAX_DIMENSION / height)
          width = Math.round(width * ratio)
          height = Math.round(height * ratio)
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0, width, height)

        // Always output as JPEG for consistent size
        const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY)
        const base64 = dataUrl.split(',')[1]
        resolve({ data: base64, mimeType: 'image/jpeg' })
      }
      img.onerror = () => reject(new Error('Failed to load image'))
      img.src = reader.result as string
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}
