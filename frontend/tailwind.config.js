/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        app: 'var(--bg-app)',
        surface: 'var(--bg-surface)',
        elevated: 'var(--bg-elevated)',
        /* Planos (no anidar fg/brand): @apply text-fg / bg-brand en index.css falla con objetos anidados en Tailwind+PostCSS. */
        fg: 'var(--text-primary)',
        'fg-muted': 'var(--text-secondary)',
        'fg-subtle': 'var(--text-muted)',
        brand: 'var(--brand)',
        'brand-hover': 'var(--brand-hover)',
        'brand-soft': 'var(--brand-soft)',
        success: 'var(--success)',
        warning: 'var(--warning)',
        error: 'var(--error)',
        info: 'var(--info)',
        'error-soft': 'var(--error-soft)',
        'success-soft': 'var(--success-soft)',
        'warning-soft': 'var(--warning-soft)',
      },
      spacing: {
        'space-1': 'var(--space-1)',
        'space-2': 'var(--space-2)',
        'space-3': 'var(--space-3)',
        'space-4': 'var(--space-4)',
        'space-5': 'var(--space-5)',
        'space-6': 'var(--space-6)',
      },
      borderColor: {
        subtle: 'var(--border-subtle)',
        active: 'var(--border-active)',
      },
      backgroundColor: {
        'overlay-hover': 'var(--hover-overlay)',
        'overlay-hover-strong': 'var(--hover-overlay-strong)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        h1: ['22px', { lineHeight: '1.3', fontWeight: '600', letterSpacing: '0.01em' }],
        h2: ['17px', { lineHeight: '1.4', fontWeight: '600', letterSpacing: '0.01em' }],
        h3: ['14px', { lineHeight: '1.4', fontWeight: '500' }],
      },
      borderRadius: {
        xl: 'var(--radius-xl)',
        card: 'var(--radius-lg)',
        control: 'var(--radius-md)',
      },
      boxShadow: {
        'focus-brand': 'var(--focus-ring)',
        'nav-glow': '0 0 20px var(--brand-glow)',
      },
      transitionDuration: {
        interaction: '150ms',
      },
      ringOffsetColor: {
        app: 'var(--bg-app)',
      },
    },
  },
  plugins: [],
};
