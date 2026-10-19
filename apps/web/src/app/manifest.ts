import type { MetadataRoute } from 'next';

// "Add to Home Screen" name and icon. Colours match --color-canvas and --color-primary.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tuition LMS',
    short_name: 'Tuition LMS',
    start_url: '/',
    display: 'standalone',
    background_color: '#f5f9ff',
    theme_color: '#2563eb',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/apple-icon.png', sizes: '180x180', type: 'image/png' },
    ],
  };
}
