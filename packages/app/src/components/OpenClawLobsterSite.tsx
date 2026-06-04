import { useEffect, useRef, useState } from 'react';
import { animate, createTimeline, stagger } from 'animejs';

type FeatureKey = 'agent' | 'memory' | 'actions';

interface Feature {
  key: FeatureKey;
  code: string;
  title: string;
  detail: string;
  metric: string;
  reveal: string;
  lobster: {
    x: number;
    y: number;
    scale: number;
    rotate: number;
  };
}

const features: Feature[] = [
  {
    key: 'agent',
    code: 'CLAWS_01',
    title: 'Personal operator',
    detail: 'A chat-first AI assistant that can work across your everyday tools.',
    metric: '24/7',
    reveal: 'The page stays pinned while scroll input advances the story. First: the agent shows up as a calm operator.',
    lobster: { x: 0, y: 0, scale: 1, rotate: 0 },
  },
  {
    key: 'memory',
    code: 'CLAWS_02',
    title: 'Persistent context',
    detail: 'Preferences, tasks, and working notes stay available between sessions.',
    metric: 'recall',
    reveal: 'Scroll again and the lobster shifts left, making room for memory: the part that keeps every task from starting cold.',
    lobster: { x: -132, y: 42, scale: 0.82, rotate: -14 },
  },
  {
    key: 'actions',
    code: 'CLAWS_03',
    title: 'Real actions',
    detail: 'Email, calendars, reminders, agents, and local workflows become reachable from chat.',
    metric: 'hands',
    reveal: 'One more scroll: the lobster moves forward and the copy focuses on action, not another static assistant demo.',
    lobster: { x: 120, y: -38, scale: 1.16, rotate: 12 },
  },
];

function OpenClawLobsterMark() {
  return (
    <svg className="oc-lobster-mark" viewBox="0 0 120 120" fill="none" aria-hidden="true">
      <path
        d="M60 10 C30 10 15 35 15 55 C15 75 30 95 45 100 L45 110 L55 110 L55 100 C55 100 60 102 65 100 L65 110 L75 110 L75 100 C90 95 105 75 105 55 C105 35 90 10 60 10Z"
        fill="url(#oc-lobster-gradient)"
        className="oc-lobster-body"
      />
      <path
        d="M20 45 C5 40 0 50 5 60 C10 70 20 65 25 55 C28 48 25 45 20 45Z"
        fill="url(#oc-lobster-gradient)"
        className="oc-lobster-claw-left"
      />
      <path
        d="M100 45 C115 40 120 50 115 60 C110 70 100 65 95 55 C92 48 95 45 100 45Z"
        fill="url(#oc-lobster-gradient)"
        className="oc-lobster-claw-right"
      />
      <path
        d="M45 15 Q35 5 30 8"
        stroke="var(--oc-coral-bright)"
        strokeWidth="2"
        strokeLinecap="round"
        className="oc-lobster-antenna"
      />
      <path
        d="M75 15 Q85 5 90 8"
        stroke="var(--oc-coral-bright)"
        strokeWidth="2"
        strokeLinecap="round"
        className="oc-lobster-antenna"
      />
      <circle cx="45" cy="35" r="6" fill="#050810" />
      <circle cx="75" cy="35" r="6" fill="#050810" />
      <circle cx="46" cy="34" r="2" fill="#00e5cc" className="oc-lobster-eye-glow" />
      <circle cx="76" cy="34" r="2" fill="#00e5cc" className="oc-lobster-eye-glow" />
      <defs>
        <linearGradient id="oc-lobster-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="var(--oc-coral)" />
          <stop offset="100%" stopColor="var(--oc-teal)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export default function OpenClawLobsterSite() {
  const [activeIndex, setActiveIndex] = useState(0);
  const pageRef = useRef<HTMLElement | null>(null);
  const lobsterRef = useRef<HTMLDivElement | null>(null);
  const orbitRef = useRef<HTMLDivElement | null>(null);
  const readoutRef = useRef<HTMLDivElement | null>(null);
  const copyRef = useRef<HTMLDivElement | null>(null);
  const progressRef = useRef<HTMLDivElement | null>(null);
  const lastWheelAtRef = useRef(0);
  const touchStartYRef = useRef<number | null>(null);
  const activeFeature = features[activeIndex] ?? features[0];
  const activeKey = activeFeature.key;

  const setScene = (nextIndex: number) => {
    setActiveIndex(Math.max(0, Math.min(features.length - 1, nextIndex)));
  };

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;

    const intro = createTimeline({
      defaults: { ease: 'outExpo' },
    });

    intro
      .add('.oc-lobster-kicker', { opacity: [0, 1], y: [-12, 0], duration: 500 })
      .add('#openclaw-lobster-title', { opacity: [0, 1], y: [24, 0], duration: 700 }, '-=260')
      .add('.oc-lobster-intro', { opacity: [0, 1], y: [18, 0], duration: 600 }, '-=420')
      .add('.oc-lobster-actions a', { opacity: [0, 1], y: [18, 0], duration: 520, delay: stagger(80) }, '-=360')
      .add('.oc-lobster-stage', { opacity: [0, 1], scale: [0.96, 1], duration: 700 }, '-=620')
      .add('.oc-lobster-feature', { opacity: [0, 1], x: [-20, 0], duration: 460, delay: stagger(70) }, '-=420');

    return () => {
      intro.revert();
    };
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    const lobster = lobsterRef.current;
    const orbitNode = orbitRef.current;
    if (!lobster || !orbitNode) return;

    const float = animate(lobster, {
      y: ['-.55rem', '.55rem'],
      duration: 2200,
      alternate: true,
      loop: true,
      ease: 'inOutSine',
      composition: 'blend',
    });
    const orbit = animate(orbitNode, {
      rotate: '1turn',
      duration: 18000,
      loop: true,
      ease: 'linear',
    });
    const claws = animate('.oc-lobster-claw-left, .oc-lobster-claw-right', {
      rotate: [-4, 5],
      scale: [0.98, 1.05],
      duration: 1450,
      alternate: true,
      loop: true,
      delay: stagger(180),
      ease: 'inOutSine',
      composition: 'blend',
    });
    const eyes = animate('.oc-lobster-eye-glow', {
      opacity: [0.45, 1],
      scale: [0.9, 1.25],
      duration: 900,
      alternate: true,
      loop: true,
      delay: stagger(120),
      ease: 'inOutSine',
    });

    return () => {
      float.revert();
      orbit.revert();
      claws.revert();
      eyes.revert();
    };
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const { lobster } = activeFeature;
    if (reduceMotion) return;
    const lobsterNode = lobsterRef.current;
    const orbitNode = orbitRef.current;
    const readoutNode = readoutRef.current;
    const copyNode = copyRef.current;
    const progressNode = progressRef.current;
    if (!lobsterNode || !orbitNode || !readoutNode || !copyNode || !progressNode) return;

    const scene = createTimeline({
      defaults: { ease: 'outExpo' },
    });

    scene
      .add(lobsterNode, {
        x: lobster.x,
        y: lobster.y,
        scale: lobster.scale,
        rotate: lobster.rotate,
        duration: 850,
      })
      .add(orbitNode, {
        scale: [0.92, 1],
        opacity: [0.52, 1],
        duration: 520,
      }, '-=760')
      .add(readoutNode, {
        opacity: [0, 1],
        x: [activeIndex === 1 ? 26 : -26, 0],
        duration: 420,
      }, '-=540')
      .add(copyNode, {
        opacity: [0.62, 1],
        y: [10, 0],
        duration: 420,
      }, '-=420')
      .add('.oc-lobster-feature', {
        scale: (_target: unknown, index: number) => (index === activeIndex ? 1.02 : 1),
        duration: 300,
        delay: stagger(30),
      }, '-=380')
      .add(progressNode, {
        '--oc-progress': `${((activeIndex + 1) / features.length) * 100}%`,
        duration: 460,
      }, '-=460');

    return () => {
      scene.revert();
    };
  }, [activeFeature, activeIndex]);

  useEffect(() => {
    const page = pageRef.current;
    if (!page) return undefined;

    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      const now = window.performance.now();
      if (now - lastWheelAtRef.current < 620 || Math.abs(event.deltaY) < 10) return;
      lastWheelAtRef.current = now;
      setScene(activeIndex + (event.deltaY > 0 ? 1 : -1));
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      if (touchStartYRef.current === null) return;
      const currentY = event.touches[0]?.clientY ?? touchStartYRef.current;
      const delta = touchStartYRef.current - currentY;
      if (Math.abs(delta) < 44) return;
      event.preventDefault();
      touchStartYRef.current = currentY;
      setScene(activeIndex + (delta > 0 ? 1 : -1));
    };

    page.addEventListener('wheel', handleWheel, { passive: false });
    page.addEventListener('touchstart', handleTouchStart, { passive: true });
    page.addEventListener('touchmove', handleTouchMove, { passive: false });

    return () => {
      page.removeEventListener('wheel', handleWheel);
      page.removeEventListener('touchstart', handleTouchStart);
      page.removeEventListener('touchmove', handleTouchMove);
    };
  }, [activeIndex]);

  return (
    <main className="oc-lobster-page" ref={pageRef}>
      <div className="oc-lobster-stars" aria-hidden="true" />
      <div className="oc-lobster-grid" aria-hidden="true" />

      <header className="oc-lobster-topbar" aria-label="OpenClaw microsite header">
        <a className="oc-lobster-wordmark" href="https://openclaw.ai/" target="_blank" rel="noreferrer">
          <span className="oc-lobster-wordmark-mark">OC</span>
          <span>OpenClaw</span>
        </a>
        <nav className="oc-lobster-links" aria-label="OpenClaw links">
          <a href="https://docs.openclaw.ai/getting-started" target="_blank" rel="noreferrer">Docs</a>
          <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
      </header>

      <section className="oc-lobster-hero" aria-labelledby="openclaw-lobster-title">
        <div className="oc-lobster-copy" ref={copyRef}>
          <p className="oc-lobster-kicker">////// OpenClaw concept</p>
          <h1 id="openclaw-lobster-title">The AI that actually does things.</h1>
          <p className="oc-lobster-intro">
            A compact, Igloo-inspired launch page built around the OpenClaw lobster mark:
            ambient, direct, and focused on action.
          </p>
          <div className="oc-lobster-scene-copy" aria-live="polite">
            <span>{activeFeature.code}</span>
            <p>{activeFeature.reveal}</p>
          </div>
          <div className="oc-lobster-actions" aria-label="Primary actions">
            <a className="oc-lobster-primary" href="https://openclaw.ai/" target="_blank" rel="noreferrer">
              Visit OpenClaw
            </a>
            <a className="oc-lobster-secondary" href="https://clawhub.ai" target="_blank" rel="noreferrer">
              Explore skills
            </a>
          </div>
        </div>

        <div className="oc-lobster-stage" aria-label="Interactive OpenClaw feature selector">
          <div className="oc-lobster-orbit" ref={orbitRef} aria-hidden="true" />
          <div className="oc-lobster-core" ref={lobsterRef}>
            <OpenClawLobsterMark />
          </div>
          <div className="oc-lobster-readout" ref={readoutRef} aria-live="polite">
            <span>{activeFeature.code}</span>
            <strong>{activeFeature.title}</strong>
            <p>{activeFeature.detail}</p>
            <b>{activeFeature.metric}</b>
          </div>
          <div className="oc-lobster-feature-list" role="tablist" aria-label="OpenClaw feature nodes">
            {features.map((feature, index) => (
              <button
                key={feature.key}
                type="button"
                role="tab"
                aria-selected={activeKey === feature.key}
                className="oc-lobster-feature"
                onClick={() => setScene(index)}
              >
                <span>{feature.code}</span>
                <strong>{feature.title}</strong>
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="oc-lobster-progress" ref={progressRef} aria-hidden="true">
        <div />
      </div>

      <section className="oc-lobster-manifesto" aria-label="Scene progress">
        <div>
          <span>{String(activeIndex + 1).padStart(2, '0')}</span>
          <strong>{activeFeature.title}</strong>
        </div>
        <p>{activeFeature.reveal}</p>
      </section>

      <footer className="oc-lobster-footer">
        <span>Scroll to move the lobster.</span>
        <span>Sound: Off</span>
      </footer>
    </main>
  );
}
