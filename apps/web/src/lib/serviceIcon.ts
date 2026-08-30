export function serviceTi(serviceType?: string | null): string {
  const s = (serviceType ?? '').toLowerCase();
  if (s.includes('embroid') || s.includes('dst') || s.includes('pes')) {
    return 'ti-needle-thread';
  }
  if (s.includes('svg') || s.includes('vector')) return 'ti-vector';
  if (s.includes('cnc') || s.includes('laser')) return 'ti-bolt';
  if (s.includes('digit') || s.includes('scissor')) return 'ti-scissors';
  return 'ti-package';
}

export function serviceThumbClass(serviceType?: string | null): string {
  const s = (serviceType ?? '').toLowerCase();
  if (s.includes('embroid') || s.includes('digit')) return 'm';
  return '';
}
