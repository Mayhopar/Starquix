import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Landing: normal document flow on a flat dark background. Sections reveal
// with a small fade-up (IntersectionObserver). No scroll-linked scaling —
// copy must be readable at every scroll position and viewport size.
// ---------------------------------------------------------------------------

const FEATURES = [
  {
    title: 'Draw, don’t configure',
    body: 'Drag components, draw boxes, type your text right on the page. No settings maze, no code.',
  },
  {
    title: 'A blog without the headache',
    body: 'Write posts in place and publish them as fast static pages. Nothing extra to set up.',
  },
  {
    title: 'Every screen, pixel-perfect',
    body: 'Preview and edit at six screen sizes, phone to desktop. What you see at each size is what visitors get.',
  },
  {
    title: 'Yours even offline',
    body: 'Your project lives in your browser, keeps working without internet, and exports whenever you want.',
  },
];

const FAQS = [
  {
    q: 'Is it really free?',
    a: 'Yes — building in your browser is free, and there is no credit card step.',
  },
  {
    q: 'Do I need to know how to code?',
    a: 'No. If you can put together a slide, you can build a page here. The AI helps with the rest.',
  },
  {
    q: 'Can I take my site elsewhere?',
    a: 'Anytime. Export your whole site as standard web files and host it wherever you like.',
  },
  {
    q: 'Is my work private?',
    a: 'Your project is stored in your own browser — nothing is uploaded until you choose to publish or export.',
  },
];

const STYLES = `
  html { background: #000; }
  body { background: #000; }
  .sq-landing { color: #e2e8f0; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; position: relative; z-index: 1; }
  .sq-display { font-family: 'KTFRublena', Arial, sans-serif; }
  .sq-mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; }

  .sq-header {
    position: fixed; top: 0; left: 0; right: 0; z-index: 50;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px clamp(16px, 4vw, 40px);
    background: rgba(5, 8, 14, 0.94); backdrop-filter: blur(6px);
    border-bottom: 1px solid rgba(26, 34, 50, 0.7);
  }
  .sq-logo { color: #eab308; letter-spacing: 0.06em; font-size: 16px; text-decoration: none; }
  .sq-header-actions { display: flex; align-items: center; gap: 18px; }
  .sq-login { color: #cbd5e1; text-decoration: none; font-size: 14px; }
  .sq-login:hover { color: #f1f5f9; text-decoration: underline; }

  .sq-btn {
    display: inline-block; padding: 15px 36px; font-size: 17px; font-weight: 600;
    color: #10131a; background: #eab308; border-radius: 6px; text-decoration: none;
    transition: transform 0.15s ease, filter 0.15s ease;
  }
  .sq-btn:hover { transform: translateY(-1px); filter: brightness(1.08); }
  .sq-btn-sm { padding: 9px 18px; font-size: 14px; border-radius: 5px; }
  .sq-btn-ghost {
    display: inline-block; padding: 15px 36px; font-size: 17px; font-weight: 600;
    color: #e2e8f0; background: transparent; border: 1px solid #2b3650; border-radius: 6px; text-decoration: none;
  }
  .sq-btn:focus-visible, .sq-landing a:focus-visible { outline: 2px solid #eab308; outline-offset: 3px; }

  .sq-section {
    max-width: 1080px; margin: 0 auto; padding: clamp(64px, 10vh, 120px) clamp(18px, 4vw, 40px);
    text-align: center;
  }
  .sq-hero { min-height: 92vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding-top: 120px; }

  .sq-eyebrow { font-size: 11px; letter-spacing: 0.22em; color: #93c5fd; margin: 0 0 16px; }
  .sq-h2 { font-size: clamp(28px, 4vw, 42px); color: #f1f5f9; line-height: 1.12; margin: 0 0 14px; }
  .sq-lead { font-size: clamp(15px, 1.6vw, 17px); line-height: 1.65; color: #a7b7cc; max-width: 640px; margin: 0 auto 34px; }

  .sq-cta-note { font-size: 13px; color: #8fa3bd; margin-top: 14px; }
  .sq-cta-note strong { color: #cbd5e1; font-weight: 600; }
  .sq-devline { font-size: 12px; color: #64748b; margin-top: 26px; letter-spacing: 0.04em; }

  .sq-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; text-align: left; }
  @media (max-width: 700px) { .sq-grid { grid-template-columns: 1fr; } }
  .sq-card { border: 1px solid #1a2232; border-radius: 8px; padding: 22px; background: rgba(8, 12, 20, 0.88); }
  .sq-card h3 { margin: 0 0 8px; font-size: 15px; font-weight: 600; color: #e2e8f0; }
  .sq-card p { margin: 0; font-size: 13.5px; line-height: 1.55; color: #8fa3bd; }

  .sq-stats { display: flex; gap: 14px; justify-content: center; flex-wrap: wrap; }
  .sq-stat { border: 1px solid #1a2232; border-radius: 8px; padding: 22px 26px; background: rgba(8, 12, 20, 0.88); width: 250px; text-align: center; }
  .sq-stat .sq-num { display: block; font-size: 34px; color: #eab308; line-height: 1; margin-bottom: 10px; }
  .sq-stat .sq-cap { font-size: 12.5px; line-height: 1.5; color: #9fb2c9; }

  /* Editor mock — populated, not skeletons */
  .sq-mock { border: 1px solid #1a2232; border-radius: 12px; background: rgba(7, 11, 18, 0.94); overflow: hidden; text-align: left; box-shadow: 0 30px 80px rgba(0,0,0,0.55); }
  .sq-mock-bar { display: flex; align-items: center; gap: 6px; padding: 10px 14px; border-bottom: 1px solid #141c2b; }
  .sq-mock-dot { width: 9px; height: 9px; border-radius: 50%; background: #1e293b; }
  .sq-mock-url { font-size: 11px; color: #64748b; background: #0d1420; border-radius: 8px; padding: 3px 12px; margin-left: 12px; }
  .sq-mock-body { display: grid; grid-template-columns: 150px 1fr 170px; gap: 1px; background: #141c2b; }
  .sq-mock-pane { background: #070b12; padding: 12px 10px; font-size: 11px; color: #8fa3bd; }
  .sq-mock-pane-title { font-size: 9px; letter-spacing: 0.18em; color: #475569; margin: 0 0 10px 4px; }
  .sq-mock-layer { padding: 5px 8px; border-radius: 4px; margin-bottom: 2px; }
  .sq-mock-layer.sel { background: rgba(234, 179, 8, 0.12); color: #eab308; }
  .sq-mock-prop { display: flex; justify-content: space-between; padding: 5px 4px; border-bottom: 1px solid #0f1624; }
  .sq-mock-prop span:last-child { color: #cbd5e1; }
  .sq-mock-swatch { display: inline-block; width: 11px; height: 11px; border-radius: 3px; background: #b45309; vertical-align: -1px; margin-right: 5px; }
  .sq-mock-canvas { background: #05080e; padding: 22px; display: flex; justify-content: center; }
  .sq-site { width: min(430px, 100%); background: #fbf7f2; border-radius: 6px; overflow: hidden; color: #292019; font-size: 11px; }
  .sq-site-nav { display: flex; justify-content: space-between; align-items: center; padding: 9px 14px; border-bottom: 1px solid #eadfd2; }
  .sq-site-logo { font-weight: 700; letter-spacing: 0.02em; }
  .sq-site-links { display: flex; gap: 10px; color: #7a6a58; }
  .sq-site-hero { padding: 22px 16px 18px; text-align: center; }
  .sq-site-hero h4 { margin: 0 0 6px; font-size: 17px; line-height: 1.2; }
  .sq-site-hero p { margin: 0 0 12px; color: #7a6a58; }
  .sq-site-btn { display: inline-block; background: #b45309; color: #fff; border-radius: 4px; padding: 6px 14px; font-weight: 600; position: relative; }
  .sq-site-btn::after {
    content: 'Button'; position: absolute; top: -17px; left: -1px; font-size: 8px; letter-spacing: 0.06em;
    background: #eab308; color: #10131a; padding: 1px 5px; border-radius: 2px; font-weight: 700;
  }
  .sq-site-btn { outline: 1.5px solid #eab308; outline-offset: 2px; }
  .sq-site-cards { display: flex; gap: 8px; padding: 0 14px 16px; }
  .sq-site-card { flex: 1; border-radius: 4px; overflow: hidden; background: #fff; border: 1px solid #eadfd2; }
  .sq-site-img { height: 44px; }
  .sq-site-card p { margin: 0; padding: 6px 8px; color: #55483a; }
  @media (max-width: 900px) { .sq-mock-body { grid-template-columns: 112px 1fr 132px; } .sq-mock-pane { font-size: 10px; padding: 10px 8px; } }
  @media (max-width: 560px) { .sq-mock-body { grid-template-columns: 1fr; } .sq-mock-pane { display: none; } }

  /* AI mock — shows a result, not placeholder bars */
  .sq-ai { border: 1px solid #1a2232; border-radius: 10px; background: rgba(7, 11, 18, 0.92); padding: 16px; max-width: 560px; margin: 0 auto; text-align: left; }
  .sq-ai-prompt { display: flex; align-items: center; gap: 10px; border: 1px solid #26314a; border-radius: 8px; padding: 12px 14px; font-size: 13px; color: #e2e8f0; margin-bottom: 14px; }
  .sq-ai-prompt .sq-spark { color: #eab308; }
  .sq-ai-step { display: flex; gap: 10px; align-items: baseline; font-size: 12.5px; color: #9fb2c9; padding: 5px 2px; }
  .sq-ai-step .sq-check { color: #4ade80; }

  .sq-faq { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px 26px; text-align: left; margin-top: 44px; }
  @media (max-width: 640px) { .sq-faq { grid-template-columns: 1fr; } }
  .sq-faq h3 { margin: 0 0 8px; font-size: 14px; color: #e2e8f0; }
  .sq-faq p { margin: 0; font-size: 13px; line-height: 1.55; color: #8fa3bd; }

  .sq-foot { padding: 36px 0 44px; font-size: 11px; letter-spacing: 0.14em; color: #64748b; text-align: center; }
  .sq-foot a { color: #93c5fd; text-decoration: none; }

  .sq-reveal { opacity: 0; transform: translateY(22px); transition: opacity 0.55s ease, transform 0.55s ease; }
  .sq-reveal.is-in { opacity: 1; transform: none; }

  @media (prefers-reduced-motion: reduce) {
    .sq-btn { transition: none; }
    .sq-reveal { opacity: 1; transform: none; transition: none; }
  }
`;

function EditorMock() {
  return (
    <div className="sq-mock">
      <div className="sq-mock-bar">
        <div className="sq-mock-dot" />
        <div className="sq-mock-dot" />
        <div className="sq-mock-dot" />
        <span className="sq-mock-url sq-mono">clayandkiln.com</span>
      </div>
      <div className="sq-mock-body">
        <div className="sq-mock-pane">
          <p className="sq-mock-pane-title sq-mono">LAYERS</p>
          <div className="sq-mock-layer">Header</div>
          <div className="sq-mock-layer">Hero</div>
          <div className="sq-mock-layer sel">Book button</div>
          <div className="sq-mock-layer">Class schedule</div>
          <div className="sq-mock-layer">Gallery</div>
          <div className="sq-mock-layer">Contact</div>
        </div>
        <div className="sq-mock-canvas">
          <div className="sq-site">
            <div className="sq-site-nav">
              <span className="sq-site-logo">Clay &amp; Kiln</span>
              <span className="sq-site-links">
                <span>Classes</span>
                <span>Gallery</span>
                <span>Contact</span>
              </span>
            </div>
            <div className="sq-site-hero">
              <h4>Handmade pottery in Portland</h4>
              <p>Small-batch ceramics &amp; weekend wheel classes</p>
              <span className="sq-site-btn">Book a class</span>
            </div>
            <div className="sq-site-cards">
              <div className="sq-site-card">
                <div className="sq-site-img" style={{ background: 'linear-gradient(135deg,#c2764a,#8a4b2d)' }} />
                <p>Mugs &amp; cups</p>
              </div>
              <div className="sq-site-card">
                <div className="sq-site-img" style={{ background: 'linear-gradient(135deg,#7d8c74,#4c5a45)' }} />
                <p>Vases</p>
              </div>
              <div className="sq-site-card">
                <div className="sq-site-img" style={{ background: 'linear-gradient(135deg,#a8875f,#6e5537)' }} />
                <p>Classes</p>
              </div>
            </div>
          </div>
        </div>
        <div className="sq-mock-pane">
          <p className="sq-mock-pane-title sq-mono">BOOK BUTTON</p>
          <div className="sq-mock-prop"><span>Text</span><span>Book a class</span></div>
          <div className="sq-mock-prop"><span>Color</span><span><span className="sq-mock-swatch" />Rust</span></div>
          <div className="sq-mock-prop"><span>Corners</span><span>Rounded</span></div>
          <div className="sq-mock-prop"><span>Size</span><span>Medium</span></div>
          <div className="sq-mock-prop"><span>Link</span><span>/classes</span></div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = 'Starquix — make a website people actually find';
    const desc =
      'Draw your website on a canvas or ask the AI — Starquix builds a real, fast site that ranks on Google. Free, in your browser, nothing to install.';
    let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.name = 'description';
      document.head.appendChild(meta);
    }
    const prevDesc = meta.content;
    meta.content = desc;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            e.target.classList.add('is-in');
            observer.unobserve(e.target);
          }
        });
      },
      { threshold: 0.15 },
    );
    rootRef.current?.querySelectorAll('.sq-reveal').forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      if (meta) meta.content = prevDesc;
    };
  }, []);

  return (
    <div className="sq-landing" ref={rootRef}>
      <style>{STYLES}</style>

      {/* Always-visible path to the goal: Log in / Start free */}
      <header className="sq-header">
        <a href="#top" className="sq-logo sq-display">
          STARQUIX
        </a>
        <div className="sq-header-actions">
          <Link to="/sign-in" className="sq-login">
            Log in
          </Link>
          <Link to="/sign-in" className="sq-btn sq-btn-sm">
            Start free
          </Link>
        </div>
      </header>

      {/* 1 · HERO */}
      <section className="sq-section sq-hero" id="top">
        <h1
          className="sq-display"
          style={{ fontSize: 'clamp(36px, 6.5vw, 62px)', color: '#eab308', lineHeight: 1.08, margin: '0 auto 24px', maxWidth: 780 }}
        >
          Make a website people actually find.
        </h1>
        <p style={{ fontSize: 'clamp(16px, 2vw, 20px)', color: '#cbd5e1', lineHeight: 1.55, margin: '0 auto 36px', maxWidth: 720 }}>
          Draw your site like a slide, or tell the AI what you want. Starquix turns it into a real, lightning-fast website built to
          show up on Google. Free, in your browser, nothing to install.
        </p>
        <Link to="/sign-in" className="sq-btn">
          Start building free
        </Link>
        <p className="sq-cta-note">
          Sign in with <strong>Google</strong> or <strong>GitHub</strong> — takes about 30 seconds. No credit card.
        </p>
        <p className="sq-devline sq-mono">For the technical: ships clean static Astro, 0 kB JS by default, source export anytime.</p>
      </section>

      {/* 2 · THE CANVAS */}
      <section className="sq-section sq-reveal">
        <p className="sq-eyebrow sq-mono">THE CANVAS</p>
        <h2 className="sq-h2 sq-display">If you can make a slide, you can make a website.</h2>
        <p className="sq-lead">
          Draw boxes, drag sections, and type your text right on the page — here, a pottery studio’s site taking shape. What you see
          is exactly what your visitors get.
        </p>
        <EditorMock />
      </section>

      {/* 3 · AI COPILOT */}
      <section className="sq-section sq-reveal">
        <p className="sq-eyebrow sq-mono">AI COPILOT</p>
        <h2 className="sq-h2 sq-display">Tell it what you want. Watch it build.</h2>
        <p className="sq-lead">
          The AI works on the same canvas you do — every step visible, every change undoable. Ask for a whole site or a small tweak.
        </p>
        <div className="sq-ai">
          <div className="sq-ai-prompt sq-mono">
            <span className="sq-spark">✦</span>
            Make a website for my pottery studio
          </div>
          <div className="sq-ai-step">
            <span className="sq-check">✓</span>
            <span>
              Added a hero — <em>“Handmade pottery in Portland”</em>
            </span>
          </div>
          <div className="sq-ai-step">
            <span className="sq-check">✓</span>
            <span>Added a class schedule with a “Book a class” button</span>
          </div>
          <div className="sq-ai-step">
            <span className="sq-check">✓</span>
            <span>Checked search-engine setup — score 100 / 100</span>
          </div>
          <div className="sq-ai-step">
            <span className="sq-check">✓</span>
            <span>Wrote it all as clean code — yours to view or export anytime</span>
          </div>
        </div>
      </section>

      {/* 4 · FOUND ON GOOGLE */}
      <section className="sq-section sq-reveal">
        <p className="sq-eyebrow sq-mono">FOUND ON GOOGLE</p>
        <h2 className="sq-h2 sq-display">Built to be found.</h2>
        <p className="sq-lead">
          Your pages ship as instant-loading static pages — the kind Google rewards — and the built-in AI audits every page until
          search engines love it.
        </p>
        <div className="sq-stats">
          <div className="sq-stat">
            <span className="sq-num sq-display">0 kB</span>
            <span className="sq-cap">of heavy code shipped, so pages open instantly</span>
          </div>
          <div className="sq-stat">
            <span className="sq-num sq-display">100</span>
            <span className="sq-cap">the SEO score the AI drives every page toward</span>
          </div>
          <div className="sq-stat">
            <span className="sq-num sq-display">6</span>
            <span className="sq-cap">screen sizes previewed live, phone to desktop</span>
          </div>
        </div>
      </section>

      {/* 5 · YOURS, NO LOCK-IN */}
      <section className="sq-section sq-reveal">
        <p className="sq-eyebrow sq-mono">NO LOCK-IN</p>
        <h2 className="sq-h2 sq-display">Site builders rent you a website. Starquix hands you the keys.</h2>
        <p className="sq-lead">
          Everything you make is yours: it works offline in your browser, and you can export the entire site as clean code and host
          it anywhere, whenever you want.
        </p>
        <div className="sq-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="sq-card">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 6 · CLOSER + FAQ */}
      <section className="sq-section sq-reveal">
        <h2 className="sq-h2 sq-display" style={{ fontSize: 'clamp(32px, 5vw, 52px)' }}>
          Stop configuring. Start shipping.
        </h2>
        <p className="sq-lead" style={{ marginBottom: 30 }}>
          Free to build. No credit card. Your first page is minutes away.
        </p>
        <div style={{ display: 'flex', gap: 14, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Link to="/sign-in" className="sq-btn">
            Start building free
          </Link>
          <Link to="/sign-in" className="sq-btn-ghost">
            I have an account — log in
          </Link>
        </div>
        <div className="sq-faq">
          {FAQS.map((f) => (
            <div key={f.q}>
              <h3>{f.q}</h3>
              <p>{f.a}</p>
            </div>
          ))}
        </div>
        <div className="sq-foot sq-mono">
          <span className="sq-display" style={{ color: '#eab308', letterSpacing: '0.06em' }}>
            STARQUIX
          </span>
          {'  ·  © 2026  ·  '}
          <Link to="/sign-in">SIGN IN</Link>
        </div>
      </section>
    </div>
  );
}
