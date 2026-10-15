const svg = (body, fill = false) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" ${
    fill
      ? 'fill="currentColor" stroke="none"'
      : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'
  }>${body}</svg>`;

export const icons = {
  upload: svg(
    '<path d="M12 15V4"/><path d="m7 9 5-5 5 5"/><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  ),
  audioFile: svg(
    '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="10" cy="16" r="2"/><path d="M12 16v-5l3 1"/>',
  ),
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z"/>', true),
  pause: svg('<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>', true),
  stepBack: svg('<path d="M18 5.5v13a1 1 0 0 1-1.6.8l-8.5-6.5a1 1 0 0 1 0-1.6l8.5-6.5A1 1 0 0 1 18 5.5z"/><rect x="5" y="5" width="2.5" height="14" rx="1"/>', true),
  stepForward: svg('<path d="M6 5.5v13a1 1 0 0 0 1.6.8l8.5-6.5a1 1 0 0 0 0-1.6L7.6 4.7A1 1 0 0 0 6 5.5z"/><rect x="16.5" y="5" width="2.5" height="14" rx="1"/>', true),
  restart: svg('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/>'),
  piano: svg(
    '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M12 4v16M16 4v16"/><path d="M6.5 4v8h3V4M14.5 4v8h3V4" fill="currentColor"/>',
  ),
  wave: svg('<path d="M2 12h2M6 8v8M10 4v16M14 7v10M18 10v4M22 12h-2"/>'),
  speed: svg('<path d="M12 14l4-4"/><path d="M3.3 19a10 10 0 1 1 17.4 0"/>'),
  zoomIn: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M11 8v6M8 11h6"/>'),
  zoomOut: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5M8 11h6"/>'),
  settings: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  download: svg('<path d="M12 4v11"/><path d="m7 10 5 5 5-5"/><path d="M5 20h14"/>'),
  metronome: svg('<path d="M9 3h6l4 18H5z"/><path d="m12 15 5-8"/><path d="M7 17h10"/>'),
  sensitivity: svg('<path d="M2 12h3l3-8 4 16 3-8h7"/>'),
  split: svg('<path d="M12 3v18"/><path d="m8 8-4 4 4 4M16 8l4 4-4 4"/>'),
  close: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  barline: svg('<path d="M10 8v13M14.5 8v13" /><path d="M7 3h10l-5 4z" fill="currentColor" stroke-width="1.5"/>'),
  eighth: svg('<ellipse cx="8.5" cy="18" rx="3.5" ry="2.6" transform="rotate(-20 8.5 18)"/><path d="M11.4 17V3.5c0 2.8 5.6 3.8 5.6 8" fill="none" stroke="currentColor" stroke-width="1.8"/>', true),
  sixteenth: svg('<ellipse cx="8.5" cy="18" rx="3.5" ry="2.6" transform="rotate(-20 8.5 18)"/><path d="M11.4 17V3.5c0 2.2 5.6 2.8 5.6 6.2M11.4 8c0 2.2 5.6 2.8 5.6 6.2" fill="none" stroke="currentColor" stroke-width="1.8"/>', true),
};
