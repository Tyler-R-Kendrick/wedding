/** @type {import('stylelint').Config} */
export default {
  extends: ['stylelint-config-standard'],
  ignoreFiles: ['node_modules/**', 'dist/**', '.astro/**', '.next/**', 'design/generated/**'],
  rules: {
    // Tailwind v4 / modern CSS at-rules the standard config does not know about.
    'at-rule-no-unknown': [
      true,
      {
        ignoreAtRules: [
          'tailwind', 'apply', 'layer', 'theme', 'source', 'utility', 'variant',
          'custom-variant', 'reference', 'config', 'plugin', 'screen', 'container',
        ],
      },
    ],
    'import-notation': null,
    // Design-token discipline: raw colors belong in DESIGN.md → exported @theme, not in component CSS.
    'color-named': 'never',
    'declaration-property-value-disallowed-list': {
      // Ban the "AI slop" default stacks; DESIGN.md defines the real fonts.
      'font-family': [/\bInter\b/, /\bRoboto\b/, /\bArial\b/, /\bHelvetica\b/, /\bSpace Grotesk\b/, /\bFraunces\b/, /\bGeist\b/, /\bPlus Jakarta Sans\b/, /\bPlayfair Display\b/, /\bCormorant\b/, /\bInstrument Serif\b/, /\b(Pinyon Script|Great Vibes|Dancing Script|Pacifico|Allura|Parisienne|Alex Brush|Sacramento|Mrs Saint Delafield)\b/],
    },
    'selector-class-pattern': null,
    'custom-property-pattern': null,
  },
};
