// Explicit deployment/serving manifest: colocated tests are never uploaded or served.
export const PUBLIC_ASSETS = [
  'styles.css', 'dom.js', 'share.js', 'domain.js', 'validation.js', 'activity-types.js',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'apple-touch-icon.png', 'manifest.webmanifest', 'share-sw.js',
];
export const ADMIN_ASSETS = [
  'app.js', 'index.html', 'admin/store.js', 'admin/views.js', 'admin/forms.js',
  'admin/editors.js', 'admin/activity-editor.js', 'admin/activity.js', 'admin/maps-lookup.js',
];
export const SITE_ASSETS = [...PUBLIC_ASSETS, ...ADMIN_ASSETS, 'share.html', 'sample.json'];
