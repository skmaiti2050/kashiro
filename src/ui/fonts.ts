// Fonts bundled with the app so nothing is fetched from the network (SIL OFL 1.1; see
// resources/fonts/ATTRIBUTION.md). Each face loads only when text needs it.
// Readable fonts, for Settings › Font.
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import '@fontsource/opendyslexic/400.css';
import '@fontsource/opendyslexic/700.css';
// Hindi and Bengali: only the script subsets (their Latin is never used), regular and bold (600 maps to 700).
import '@fontsource/noto-sans-devanagari/devanagari-400.css';
import '@fontsource/noto-sans-devanagari/devanagari-700.css';
import '@fontsource/noto-sans-bengali/bengali-400.css';
import '@fontsource/noto-sans-bengali/bengali-700.css';
