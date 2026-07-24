export const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
export const fmtDate = value => {
  if (!value) return 'Date unknown';
  const d = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat('en-US',{year:'numeric',month:'short',day:'numeric',timeZone:'UTC'}).format(d);
};
export const yearOf = value => Number(String(value || '').slice(0,4)) || 0;
export const downloadJson = (filename, data) => {
  const blob = new Blob([JSON.stringify(data,null,2)], {type:'application/json'});
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
};
export const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
export const debounce = (fn, wait=150) => { let timer; return (...args) => { clearTimeout(timer); timer=setTimeout(()=>fn(...args),wait); }; };
export const icon = name => ({timeline:'☷',shows:'▦',wrestlers:'◎',picks:'✦',companies:'▥',library:'▣',search:'⌕',filter:'≡',check:'✓',play:'▶',link:'↗',close:'×',download:'⇩',upload:'⇧',refresh:'↻',cloud:'☁'}[name] || '•');
