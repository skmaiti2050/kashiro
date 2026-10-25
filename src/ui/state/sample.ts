/** The name the sample opens under ("Try a sample paragraph" on the start screen). */
export const SAMPLE_NAME = 'Sample.txt';

/**
 * A short sample with one of each card: simple fixes ("teh", on the one-click card), single reviews ("could of"),
 * batches ("recieve" and "alot", twice each), a names card (Priya Deshmukh, Wadgaon) and a terms card
 * ("ferrocement", three times). "colour" and "lakh" give the English-variant chip something to show.
 * The controller test checks that it keeps producing each card.
 */
export const SAMPLE_TEXT = [
  'Priya Deshmukh met the farmers of Wadgaon on Monday. Each farmer should recieve a fair share of water, and every ' +
    'family will recieve a printed card. The ferrocement tanks hold the rain; the ferrocement walls stay cool, and the ' +
    'ferrocement lids keep out dust.',
  'The plan costs 2 lakh rupees, and teh colour-coded map shows which fields come first. We could of finished it ' +
    'sooner, but alot of the data came in late, and alot of it was handwritten. The village will vote on the repairs ' +
    'next week.',
].join('\n\n');
