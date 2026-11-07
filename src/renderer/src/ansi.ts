// ANSI escape code parser for rendering terminal output in the browser

export interface ANSISegment {
  text: string;
  styles: ANSISTyles;
}

export interface ANSISTyles {
  fg?: string;
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  blink?: boolean;
  reverse?: boolean;
  hidden?: boolean;
  strikethrough?: boolean;
}

// ANSI color codes mapping
const ANSI_COLORS: Record<number, string> = {
  30: '#000000',  // Black
  31: '#FF5555',  // Red
  32: '#50FA7B',  // Green
  33: '#F1FA8C',  // Yellow
  34: '#BD93F9',  // Blue
  35: '#FF79C6',  // Magenta
  36: '#8BE9FD',  // Cyan
  37: '#F8F8F2',  // White
  90: '#6272A4',  // Bright Black
  91: '#FF6E6E',  // Bright Red
  92: '#69FF94',  // Bright Green
  93: '#FFFFA5',  // Bright Yellow
  94: '#D6ACFF',  // Bright Blue
  95: '#FF92DF',  // Bright Magenta
  96: '#A4FFFF',  // Bright Cyan
  97: '#FFFFFF',  // Bright White
  40: '#000000',  // BG Black
  41: '#FF5555',  // BG Red
  42: '#50FA7B',  // BG Green
  43: '#F1FA8C',  // BG Yellow
  44: '#BD93F9',  // BG Blue
  45: '#FF79C6',  // BG Magenta
  46: '#8BE9FD',  // BG Cyan
  47: '#F8F8F2',  // BG White
  100: '#6272A4', // BG Bright Black
  101: '#FF6E6E', // BG Bright Red
  102: '#69FF94', // BG Bright Green
  103: '#FFFFA5', // BG Bright Yellow
  104: '#D6ACFF', // BG Bright Blue
  105: '#FF92DF', // BG Bright Magenta
  106: '#A4FFFF', // BG Bright Cyan
  107: '#FFFFFF', // BG Bright White
};

// Parse ANSI escape codes and return styled segments
export function parseANSI(text: string): ANSISegment[] {
  const segments: ANSISegment[] = [];
  let currentStyles: ANSISTyles = {};

  // Regex to match ANSI escape sequences
  const ansiRegex = /\x1b\[([0-9;]*)m/g;
  let lastIndex = 0;
  let match;

  while ((match = ansiRegex.exec(text)) !== null) {
    // Add text before this escape sequence
    const textBefore = text.slice(lastIndex, match.index);
    if (textBefore) {
      segments.push({ text: textBefore, styles: { ...currentStyles } });
    }

    // Parse the SGR codes
    const codes = match[1];
    if (codes) {
      const parts = codes.split(';').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
      applySGRCodes(parts, currentStyles);
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), styles: { ...currentStyles } });
  }

  // If no segments were created (no ANSI codes or empty text), return early
  if (segments.length === 0) {
    return [];
  }

  return mergeSegments(segments);
}

function applySGRCodes(codes: number[], styles: ANSISTyles) {
  let i = 0;
  while (i < codes.length) {
    const code = codes[i];
    
    switch (code) {
      case 0:
        // Reset all
        Object.keys(styles).forEach(key => delete styles[key as keyof ANSISTyles]);
        break;
      case 1:
        styles.bold = true;
        break;
      case 2:
        styles.dim = true;
        break;
      case 3:
        styles.italic = true;
        break;
      case 4:
        styles.underline = true;
        break;
      case 5:
        styles.blink = true;
        break;
      case 7:
        styles.reverse = true;
        break;
      case 8:
        styles.hidden = true;
        break;
      case 9:
        styles.strikethrough = true;
        break;
      case 22:
        delete styles.bold;
        delete styles.dim;
        break;
      case 23:
        delete styles.italic;
        break;
      case 24:
        delete styles.underline;
        break;
      case 25:
        delete styles.blink;
        break;
      case 27:
        delete styles.reverse;
        break;
      case 28:
        delete styles.hidden;
        break;
      case 29:
        delete styles.strikethrough;
        break;
      case 39:
        delete styles.fg;
        break;
      case 49:
        delete styles.bg;
        break;
      case 38:
        if (codes[i + 1] === 5 && i + 2 < codes.length) {
          // 256-color foreground
          styles.fg = `#${codes[i + 2].toString(16).padStart(2, '0')}`;
          i += 3;
        } else if (codes[i + 1] === 2 && i + 4 < codes.length) {
          // Truecolor foreground
          const r = codes[i + 2].toString(16).padStart(2, '0');
          const g = codes[i + 3].toString(16).padStart(2, '0');
          const b = codes[i + 4].toString(16).padStart(2, '0');
          styles.fg = `#${r}${g}${b}`;
          i += 5;
        } else {
          i++;
        }
        break;
      case 48:
        if (codes[i + 1] === 5 && i + 2 < codes.length) {
          // 256-color background
          styles.bg = `#${codes[i + 2].toString(16).padStart(2, '0')}`;
          i += 3;
        } else if (codes[i + 1] === 2 && i + 4 < codes.length) {
          // Truecolor background
          const r = codes[i + 2].toString(16).padStart(2, '0');
          const g = codes[i + 3].toString(16).padStart(2, '0');
          const b = codes[i + 4].toString(16).padStart(2, '0');
          styles.bg = `#${r}${g}${b}`;
          i += 5;
        } else {
          i++;
        }
        break;
      default:
        if (ANSI_COLORS[code] !== undefined) {
          if (code >= 30 && code <= 37) {
            styles.fg = ANSI_COLORS[code];
          } else if (code >= 90 && code <= 97) {
            styles.fg = ANSI_COLORS[code];
          } else if (code >= 40 && code <= 47) {
            styles.bg = ANSI_COLORS[code];
          } else if (code >= 100 && code <= 107) {
            styles.bg = ANSI_COLORS[code];
          }
        }
        break;
    }
    i++;
  }
}

function mergeSegments(segments: ANSISegment[]): ANSISegment[] {
  if (segments.length === 0) return segments;
  
  const merged: ANSISegment[] = [];
  let current = segments[0];
  
  for (let i = 1; i < segments.length; i++) {
    const next = segments[i];
    if (stylesEqual(current.styles, next.styles)) {
      current.text += next.text;
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  
  return merged;
}

function stylesEqual(a: ANSISTyles, b: ANSISTyles): boolean {
  return a.fg === b.fg && a.bg === b.bg && a.bold === b.bold &&
         a.dim === b.dim && a.italic === b.italic && a.underline === b.underline &&
         a.blink === b.blink && a.reverse === b.reverse && a.hidden === b.hidden &&
         a.strikethrough === b.strikethrough;
}

// Convert ANSI styles to React CSSProperties object
export function stylesToCSS(styles: ANSISTyles): React.CSSProperties {
  const result: React.CSSProperties = { display: 'inline' };
  
  if (styles.fg) result.color = styles.fg;
  if (styles.bg) result.backgroundColor = styles.bg;
  if (styles.bold) result.fontWeight = 'bold';
  if (styles.dim) result.opacity = 0.5;
  if (styles.italic) result.fontStyle = 'italic';
  if (styles.underline || styles.strikethrough) {
    const decorations: string[] = [];
    if (styles.underline) decorations.push('underline');
    if (styles.strikethrough) decorations.push('line-through');
    result.textDecoration = decorations.join(' ');
  }
  if (styles.blink) result.animation = 'blink 1s step-end infinite';
  if (styles.reverse) result.filter = 'invert(1)';
  if (styles.hidden) result.visibility = 'hidden';
  
  return result;
}
