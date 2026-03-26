// Build sidebar nav from section h2 headings
(function() {
  const nav = document.getElementById('sidebar-nav');
  const headings = document.querySelectorAll('.section h2');
  headings.forEach(h => {
    const section = h.closest('.section');
    if (!section.id) return;
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = '#' + section.id;
    a.textContent = h.textContent;
    li.appendChild(a);
    nav.appendChild(li);
  });

  // Scroll-spy: highlight active section
  const links = nav.querySelectorAll('a');
  const observer = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        links.forEach(l => l.classList.remove('active'));
        const active = nav.querySelector('a[href="#' + entry.target.id + '"]');
        if (active) active.classList.add('active');
      }
    });
  }, { rootMargin: '-10% 0px -80% 0px' });

  document.querySelectorAll('.section[id]').forEach(s => observer.observe(s));
})();

// Mermaid init
function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: 'dark',
    securityLevel: 'loose',
    themeVariables: {
      darkMode: true,
      background: '#0d0d0d',
      primaryColor: '#141414',
      primaryBorderColor: '#333333',
      primaryTextColor: '#e0e0e0',
      secondaryColor: '#141414',
      tertiaryColor: '#141414',
      lineColor: '#999999',
      textColor: '#e0e0e0',
      mainBkg: '#141414',
      nodeBorder: '#333333',
      clusterBkg: '#141414',
      clusterBorder: '#333333',
      titleColor: '#ccff00',
      edgeLabelBackground: '#0d0d0d',
      nodeTextColor: '#e0e0e0'
    }
  });
  document.querySelectorAll('.mermaid').forEach((el, i) => {
    const id = 'mermaid-' + i;
    const code = el.getAttribute('data-source') || el.textContent;
    el.setAttribute('data-source', code);
    el.innerHTML = '';
    mermaid.render(id, code).then(({svg}) => { el.innerHTML = svg; });
  });
}
initMermaid();