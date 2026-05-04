export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        mc: {
          bg: {
            primary: 'var(--bg-primary)',
            secondary: 'var(--bg-secondary)',
            tertiary: 'var(--bg-tertiary)',
          },
          border: {
            primary: 'var(--border-primary)',
            secondary: 'var(--border-secondary)',
          },
          text: {
            primary: 'var(--text-primary)',
            secondary: 'var(--text-secondary)',
            muted: 'var(--text-muted)',
          },
          accent: 'var(--accent)',
          'accent-dim': 'var(--accent-dim)',
          success: 'var(--success)',
          error: 'var(--error)',
          overlay: 'var(--overlay-strong)',
          surface: {
            accent: 'var(--surface-accent)',
            'accent-strong': 'var(--surface-accent-strong)',
            success: 'var(--surface-success)',
            error: 'var(--surface-error)',
            muted: 'var(--surface-muted)',
          },
        },
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};
