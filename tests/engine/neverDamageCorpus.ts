/**
 * The never-damage stress test's documents: correct prose built from fixed templates, full of traps the
 * engine must never change on its own (CLAUDE.md rule #1), plus a few planted errors with one approved fix.
 *
 * Template markers:
 * - `[[…]]`  a trap: no automatic change may touch it (an invisible character inside it may be deleted);
 * - `<<wrong|right>>`  a planted error: the one approved automatic change there is `wrong` → `right`;
 * - `{{200B}}`  an invisible character the hygiene rule may delete (U+ hex code).
 * Invisible characters written as `\u{…}` without `{{…}}` are part of the text (a joiner Indic script needs).
 */

/** A paragraph of the generated document, with what the checks need to judge each automatic change. */
export interface StressParagraph {
  text: string;
  /** [start, end) of each trap, in `text`. */
  traps: { start: number; end: number }[];
  /** Planted errors: the span and its one approved replacement. */
  fixes: { start: number; end: number; right: string }[];
  /** Offsets of invisible characters the hygiene rule may delete. */
  junk: Set<number>;
}

/** Correct, plain sentences between the traps. */
const FILLERS = [
  'The team met on Monday to review the plan.',
  'We will share the final numbers next week.',
  'Most of the work is already done.',
  'Please send the form back when you can.',
  'The bus was late again this morning.',
  'Our office opens at nine and closes at six.',
  'She thanked everyone for their patience.',
  'The rain stopped just before noon.',
  'We need two more chairs for the hall.',
  'The children walked home after school.',
  // Two spaces between words: collapsing them is one of the two changes made without a click.
  'The hall was  full by ten.',
];

/** Sentences with traps: legitimate text a careless rule would "fix". */
const TRAPS = [
  // Grammatical doubling (review #4, C1).
  'He [[had had]] enough of the delays.',
  'She knew [[that that]] was the hard part.',
  'What it [[is is]] a question of time.',
  'What it [[was was]] plain bad luck.',
  'Please log [[in in]] the morning.',
  'Turn the pump [[on on]] Monday.',
  'I [[do do]] read every reply.',
  'They served [[hot hot]] pakoras at the stall.',
  'He typed "[[is is]]" by mistake.',
  '“He [[had had]] enough,” she said.',
  // A slip-list word before a word it starts: a hyphen or apostrophe continues it (F3 re-review, D1). The linter
  // flags these only after a paragraph's first sentence, hence the short sentence before each.
  'It rained. He worked [[for for-profit]] colleges.',
  'It rained. Invest [[with with-profits]] funds.',
  'It rained. Notes [[for for-loop]] code.',
  'It rained. They wrote [[and and-gate]] logic.',
  'It rained. Pick [[a a-la-carte]] meal.',
  'It rained. We went [[to to’s]] house.',
  "It rained. We went [[to to's]] house.",
  'It rained. He built [[a lean-to to]] keep dry.',
  // Invisible characters hygiene leaves in place, inside a word after an article (F3 re-review, D2).
  'We saw [[a m\u{200E}ean]] value.',
  'We saw [[a m\u{2066}ean\u{2069}]] value.',
  'We saw [[a m\u{FE0F}ean]] value.',
  'It was [[a m\u{034F}ean]] trick.',
  'It is [[a m\u{2061}ean]] score.',
  'Read [[the te\u{180B}xt]] now.',
  // A direction-control pair with one end in a quote or code span (F3 re-review, D3).
  'He said "[[{{202E}}sales]]" today{{202C}} and left.',
  'Run [[`ls{{202E}} -la`]] now{{202C}} please.',
  // Invisible and bidi characters inside and next to words (review #4, C3).
  'We saw [[a m{{2060}}ean]] value.',
  'We trained the [[mod{{200B}}els]] well.',
  'The [[re{{00AD}}port]] is ready.',
  'The [[{{FEFF}}draft]] is attached.',
  'Read the [[note{{202E}}s]] first.',
  // Any other character after a doubling continues the word too: a slash, plus, dot or hash (F3 re-review 2, C-1).
  'It rained. Avoid mixing [[and and/or]] in one clause.',
  'It rained. Count the votes [[for for/against]] motions.',
  'It rained. Serve tea [[with with/without]] sugar.',
  'It rained. Write [[the the/a]] choice down.',
  'It rained. Pick [[a a+]] grade.',
  'It rained. We code [[for for.NET]] users.',
  'It rained. Tag it [[with with#hash]] now.',
  // A doubling only a Grammar flag touches (F3 re-review 2, I-3).
  'It rained. Let it [[be be-bop]] music.',
  // Articles the user wrote right: joined by a slash, or before a word said with a "you" sound (C-2, C-3).
  'It rained. Use [[a/an]] correctly in every sentence.',
  'It rained. Plug in [[a usb]] drive.',
  'It rained. She is preparing for [[a upsc]] exam.',
  // An abbreviation's full stop is not a sentence end, with or without a mark before it (C-4, I-1).
  'It rained. The [[Govt. of]] India said so.',
  'It rained. He joined Infosys [[Pvt. Ltd. last]] year.',
  'It rained. Bring pens, books [[etc\u{200E}. and]] the rest.',
  'It rained. Use one, [[i.e\u{200E}. the]] best.',
  // Direction pairs around an isolate: the PDI closes the inner embedding, so the last PDF ends the RLO (I-2).
  'Total [[{{202E}}abc \u{2066}x\u{202B}y\u{2069} z{{202C}}]] and the rest is plain.',
  'Total [[{{202E}}abc \u{2068}x\u{202D}y\u{2069} z{{202C}}]] and the rest is plain.',
  // Spaces around a direction control hygiene keeps: a spacing fix must not take the control with it (I-4).
  'He said "[[{{202E}}sales]]" today  {{202C}}  and left.',
  'The [[cost{{180E}}s]] went up.',
  'The [[{{202B}}sales]] rose this year.',
  'The [[sum{{200C}}mary]] is short.',
  'The [[pa{{202A}}per{{202C}}s]] are here.',
  'He said [[a{{200B}}n]] [[apple]] fell.',
  'It was [[an{{200D}}]] [[old]] house.',
  // Acronyms and mixed case.
  'Update the [[SOPs]] before the audit.',
  'My [[iPhone]] needs a new charger.',
  'Complete the [[eKYC]] online.',
  'The [[UPI]] payment failed twice.',
  // Names and places.
  'We met [[Anirban Chatterjee]] at the station.',
  'The trek to [[Kalsubai]] starts early.',
  'Ask [[Mr. D’Souza]] about the bill.',
  'The note from [[Priya Raghunathan]] arrived today.',
  // Numbers and amounts, Devanagari and Bengali digits included.
  'The flat costs [[₹1,25,000]] a year.',
  'The grant is [[Rs 5 lakh]] this time.',
  'Turnover crossed [[3.5 crore]] in [[2024-25]].',
  'Room [[१२३]] is on the left.',
  'The fee is [[৪৫৬]] taka.',
  'The train leaves at [[10:30]] sharp.',
  // Indian English.
  'Can we [[prepone]] the meeting?',
  'He is [[out of station]] till Monday.',
  'My [[cousin-brother]] lives in Pune.',
  // Romanised Indian-language words.
  'We ate [[ukadiche modak]] at home.',
  'That fix was pure [[jugaad]].',
  'We stopped for [[chai]] at the [[dhaba]].',
  // Quotes, URLs, email and code spans.
  'She wrote, “[[The the cat sat]].”',
  'See [[https://example.org/path_to/file?id=12&x=y]] for details.',
  'Visit [[www.example.co.in]] today.',
  'Email [[ops@example.in]] for help.',
  'Copy it to [[\\\\localhost\\C$\\Reports]] first.',
  'Run [[`npm run build`]] before you push.',
  'Use [[`total = total + 1`]] in the loop.',
  // Columns lined up with spaces: preformatted text, whose spaces are layout.
  'Stock today:\n[[Pens    10]]\n[[Ink     25]]',
  // The simple-fixes card's default ticks (F4 re-review 3): "apply all" must not make these.
  // A capital after an abbreviation's dot that no list names (I-2), and "Ph" → "pH" inside "Ph.D.".
  'Meet at 5 [[pm. tomorrow]] please.',
  '[[Jan. was]] cold.',
  '[[Bros. came]] home.',
  '[[Hon. minister]] came.',
  '[[Wt. and]] ht. noted.',
  '[[Qty. ten]] is fine.',
  '[[Amt. due]] is ten.',
  '[[Ave. road]] is long.',
  'It rained today. [[Engg. college]] is near.',
  'It rained today. [[Ph.D.]] students came.',
  'The proof went to the HoD. [[Ph.D.]] scholars wait.',
  'She has a [[Ph.D.]] in physics.',
  // An article before an initialism or a "you" sound (I-3), and two fixes that combine into a wrong pair ("a SMS").
  'It is [[a ewe]] lamb.',
  'Buy [[an lpg]] cylinder.',
  'He is [[an rss]] member.',
  'He got [[an sms]] today.',
  'See [[an hr]] manager.',
  'He is [[an mla]] now.',
  'He is [[an nri]] now.',
  'File [[an fir]] today.',
  // Spaces the zero-click rule refuses as layout are not ticked on the card either (M-4).
  'Use [[tabs\t\there]] please.',
  // F5 re-review 4: shapes the F5 tick gate guessed wrong. Only the closed tick set (Task F6) may start ticked.
  // An article before a word whose sound its spelling doesn't tell (I-1).
  'Police found [[an unidentified]] man near the gate.',
  '[[An unidentified]] caller rang twice.',
  'It was [[an unidentifiable]] object.',
  'The sea urchin is [[an urchin]] of the reef.',
  'It was done with [[an utmost]] care.',
  'He has [[an urticaria]] rash.',
  'The new rules are [[an onerous]] burden.',
  'She filled [[a ewer]] with water.',
  // A capital after a long lowercase abbreviation or a spaced ellipsis (I-2).
  'See page four, [[contd. from]] the last issue.',
  'He works in the [[deptt. of]] physics.',
  'Ask the [[admin. team]] about it.',
  'See the [[illus. below]] for details.',
  'Use the [[abbrev. form]] here.',
  '[[Hmm . . . yes]], we can.',
  '[[Wait . . . then]] go.',
  // A capital after "!" inside a sentence, or on an inline list label (I-3).
  'I use [[Yahoo! mail]] every day.',
  'He won on [[Jeopardy! last]] night.',
  'We played [[Yahtzee! and]] Boggle! today.',
  'We use [[Yahoo! for]] search.',
  '[[a) the]] first point. [[b) the]] second point.',
  // "i" → "I" in a list label, maths or code (I-4).
  'Options: [[(i)]] first, [[(ii)]] second.',
  'Part [[i]] and part [[ii]] are done.',
  'Let [[i]] be an index and x = [[i]] + 1.',
  'Run [[for i in range(10): print(i)]] now.',
  // Dot runs, and punctuation spacing in code-like text (M-4, M-5).
  'It is [[fine.. done]] now.',
  '[[Wait.... there]] it is.',
  'Use [[...]] here please.',
  'Call [[foo(a ,b)]] and [[x = y ,z]] today.',
];

/**
 * A key–value block whose lines are paragraphs of their own (F4 re-review 3, M-3): its spaces are layout,
 * like the columns above, even though no one paragraph shows it.
 */
const KEY_VALUE_BLOCK = [
  '[[Name      Rahul Sharma]]',
  '[[City      Pune]]',
  '[[Amount    500]]',
  '[[Score: India 250  Australia 245]]',
  // A colon key, and lines ending with a full stop (F5 re-review 4, M-3).
  '[[Guardian:      Mr. Anil Sharma]]',
  '[[Company     Acme Pvt. Ltd.]]',
  '[[Address     12 MG Road, Pune.]]',
];

/**
 * A runbook (Task F20 item 1, owner's AWS runbook): commands with --flags, a trailing " \" and its continuation
 * lines, "sudo" at a line start, a doubling inside a command, en-dash bait, and prose fixes around them. Each
 * command is a trap: no change made without a click, and no tick on the simple-fixes card, may touch it.
 */
const RUNBOOK_BLOCK = [
  'Disaster recovery runbook. First log in to the jump host. then switch to root.',
  'Step 3. Stop the service on each node.\n[[sudo systemctl stop nginx]]\n[[sudo systemctl status nginx]]',
  "[[Run: aws ec2 describe-instances --region ap-south-1 \\\n  --query 'Reservations[].Instances[].InstanceId' \\\n  --output text]]",
  '[[docker build -t app:latest . \\\n  --no-cache]]',
  '[[Run: aws s3 ls \\]]',
  '[[sudo apt-get install -y \\\n  nginx \\\n  curl]]',
  '[[$ docker ps -a --filter status=exited]]',
  '[[echo the the > notes.txt]]',
  '[[cd /opt/app && npm ci && npm run build]]',
  'Use the [[--dry-run]] flag first, and check the output -- it should list every bucket.\nPass [[-v]] for more detail , and then run it again.',
  'Restore the snapshot. This takes about ten minutes -- so wait  for it. we are done.',
  // Two spaces before a continuation: never collapsed without a click.
  '[[ls -la  \\\n/var/log]]',
  // Task F21 item A: commands found by their shape, not a word list. The owner's repros first.
  '[[until sudo docker pull ${SRC}; do\n  sleep 5\ndone]]',
  '[[# Install docker if not present\nsudo apt-get install -y docker.io]]',
  '[[gh secret set FOO --body "$X"]]',
  "[[aws ec2 describe-instances --query 'Reservations[].Instances[].{\nId:InstanceId; Type:InstanceType;\nState:State.Name}' --output table]]",
  'Scripts use [[sudo su ubuntu]] to switch user.',
  // F20 adversarial review I-1 (a doubling a click would undo) and M-19 (spaces in a here-document body).
  '[[cat <<EOF > words.txt\nthe the\nEOF]]',
  '[[make the the]]',
  '[[cat <<EOF > config.yml\nname: my app\nport:  8080\nretries: 3 , 4\nEOF]]',
  // M-16: loops, redirects, here-documents, unlisted commands, a Makefile, YAML and a multi-line quoted argument.
  'Install Docker on the host first.',
  '[[until sudo docker pull ${SRC}; do]]',
  '[[  sleep 5]]',
  '[[done]]',
  'Use the docker CLI. The docker daemon must run. [[until sudo docker pull ${SRC}; do sleep 5; done]]',
  '[[if true; then echo hi; fi]]',
  '[[for i in 1 2 3; do echo $i; done]]',
  '[[for f in *.log; do gzip $f; done]]',
  '[[node app.js > out.log 2>&1]]',
  '[[tee /etc/app.conf <<EOF\nhost = localhost\nlog level = debug\nEOF]]',
  '[[make install]]',
  '[[node index.js --port 3000]]',
  '[[brew install jq\napt-get install curl\nyum install git\nmv a b\nrm -rf build\ntouch file.txt\nwget https://x.y/z\nnode index.js\nmake build\ngo run .\ncargo build\nyarn add react\nps aux\nkill -9 123\nsystemd-analyze blame\nservice nginx restart\nopenssl rand -hex 32\ntar xzf a.tgz\nunzip a.zip\nsource venv/bin/activate]]',
  '[[build:\n\tgo build -o bin/app ./cmd/app\n\ttest:  lint\n\tgo test ./...]]',
  'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n[[  name: web]]\nspec:\n[[  replicas]]:  3',
  "[[aws ec2 describe-instances \\\n  --filters \"Name=tag:Env,Values=prod\" \\\n  --query 'Reservations[].Instances[].{\n    id: InstanceId;\n    type: InstanceType;\n    az: Placement.AvailabilityZone\n  }']]",
  // A .docx puts each line in its own paragraph: a continuation or an open quote carries on into the next one.
  '[[aws ec2 describe-instances \\]]',
  '[[  --region ap-south-1 \\]]',
  "[[  --query 'Reservations[].Instances[].{Id:InstanceId; Type:InstanceType}' \\]]",
  '[[  --output table]]',
  '[[sudo docker run -d \\]]',
  '[[  -p 80:80 \\]]',
  '[[  nginx:latest]]',
  "[[aws ec2 describe-instances --query 'Reservations[].Instances[].{]]",
  '[[Id:InstanceId; Type:InstanceType;]]',
  "[[State:State.Name}' --output table]]",
  // Review M-17: spelling batches on command words ("docker → Docker", "gh → go") reached commands with Tick all.
  'Steps:\n[[1. until sudo docker pull ${SRC}; do sleep 5; done\n2. # install docker if not present\n3. gh secret set FOO --body "$X"]]',
  'Store the token:',
  '[[gh secret set FOO --body "$X"]]',
  '[[gh auth login]]',
  // Task F21 item E (review M-18, E4, E9): identifiers get no spelling, word or capital fix.
  'Attach [[sg-0a1b2c3d4e5f67890]] to [[i-0abcd1234efgh5678]] now.',
  'The role is [[arn:aws:iam::123456789012:role/deploy-role-prod]] and the bucket [[arn:aws:s3:::my-bucket-logs]].',
  'Launch from the image ([[ami-0123456789abcdef0]]) in the region.',
  'Use [[vpc-0a1b2c3d4e5f60718]] and [[subnet-0f1e2d3c4b5a69788]] for the cluster.',
  'The request id was [[3f2a9c1e-7b4d-4e8a-9f0c-1d2e3f4a5b6c]] after commit [[3911a5b]].',
];

/** The runbook's paragraphs, with its commands as traps. */
export function runbookParagraphs(): StressParagraph[] {
  return RUNBOOK_BLOCK.map((line) => toParagraph(parseTemplate(line)));
}

/** Paragraph openers: list labels the format does not draw itself. */
const LIST_LABELS = ['[[a.]] ', '[[(iv)]] ', '[[1.]] ', '[[b)]] '];

/** Whole paragraphs in Hindi and Bengali, with the joiners (ZWJ, ZWNJ) their scripts need. */
const INDIC = [
  '[[यह एक छोटा सा परीक्षण है। हम कल बाज़ार गए थे।]]',
  '[[आमरा काल बाजारे गियेछिलाम। एटा एकटा छोटो परीक्षा।]]',
  '[[क्\u{200D}ष और क्\u{200C}ष दोनों सही हैं।]]',
  '[[র\u{200D}্যাব আর ক্\u{200C}ষ দুটোই ঠিক।]]',
  '[[আমরা কাল বাজারে গিয়েছিলাম। এটা একটা ছোট পরীক্ষা।]]',
];

/** Planted errors with their one approved automatic fix. */
const PLANTED = [
  'I think <<teh|the>> plan works.',
  'He ate <<a|an>> apple.',
  'We went to <<the the|the>> market.',
  // A second doubling, so "Review and apply all" (doublings only since Task F8) still has enough to fix.
  'It is part <<of of|of>> the plan.',
  // Harper writes "AN" after a capital "A" (F4 re-review 3, I-1): the one right fix keeps the case.
  '<<A|An>> elephant came.',
];

/**
 * The truth table for the simple-fixes card's default ticks (Task F6, F5 re-review 4 M-1): each input with the
 * exact fixes that may start ticked, as "original → replacement @ offset" (the offset of the original in `input`).
 * It is written by hand, not derived from the engine's rules, so a gate that ticks anything else fails whatever its
 * own definitions say. A fix matches only at its offset, so a second, wrong "a → an" in a row that allows one
 * fails (F6 re-review 5, M-6). No other batch card may tick anything on any input (Task F10).
 * - `ticked`: the closed tick set covers every fix in `mayTick`, so with default settings they all start ticked
 *   (the table can't pass by the card ticking nothing);
 * - `markdown`: the input is read as Markdown (a table cell), otherwise as plain text.
 */
export interface TickTruth {
  input: string;
  mayTick: readonly string[];
  ticked?: boolean;
  markdown?: boolean;
}

export const TICK_TRUTH: readonly TickTruth[] = [
  // The closed set: a doubled word on the allowlist.
  { input: 'We went to the the market.', mayTick: ['the the → the @ 11'], ticked: true },
  { input: 'It is part of of the plan.', mayTick: ['of of → of @ 11'], ticked: true },
  // Task F8 (owner decision 2026-10-26): no a/an swap starts ticked, however right it is.
  { input: 'He ate a apple.', mayTick: [] },
  { input: 'A apple fell. A elephant came.', mayTick: [] },
  { input: 'It is an useful tool.', mayTick: [] },
  { input: 'Wait a hour please.', mayTick: [] },
  { input: 'a apple', mayTick: [] },
  { input: 'A apple', mayTick: [] },
  { input: 'He ate a apple and the the cake.', mayTick: ['the the → the @ 19'], ticked: true },
  // F7 re-review 6, I-1: "an" or "a" typed for "and"; M-1: a letter label; M-2: Spanish "a".
  { input: 'My mother an father came to the school.', mayTick: [] },
  { input: 'Bring a pen an paper to the exam.', mayTick: [] },
  { input: 'Fill the form an hand it over.', mayTick: [] },
  { input: 'I like apple a orange.', mayTick: [] },
  { input: 'Grades: A excellent, B good, C average.', mayTick: [] },
  { input: 'Vamos a animal planet mañana.', mayTick: [] },
  // F8 re-review 7, M-1: "A a" is the alphabet pair on a worksheet, wherever it stands; so is a real "A a man" slip.
  { input: 'A a B b C c', mayTick: [] },
  { input: 'Letters: A a, B b.', mayTick: [] },
  { input: 'We left. A a man came in.', mayTick: [] },
  { input: 'अंग्रेज़ी वर्णमाला: A a, B b, C c.', mayTick: [] },
  { input: '- A a\n- B b\n- C c', mayTick: [], markdown: true },
  { input: '| A a | B b |\n|---|---|\n| C c | D d |', mayTick: [], markdown: true },
  // Task F10: a doubled "a" in any case, lowercase phonics included, and so the real slip "a a lot" too.
  { input: 'a a b b c c', mayTick: [] },
  { input: 'Say the sounds: a a, b b.', mayTick: [] },
  { input: '- a a\n- b b', mayTick: [], markdown: true },
  { input: 'It was a a lot of work.', mayTick: [] },
  // Task F11 (final F10 review I-2): a doubled "an" in any case, like "a a"; so the real slip "An an apple" too.
  { input: 'An an. Bn bn.', mayTick: [] },
  { input: 'Sounds: an an, in in.', mayTick: [] },
  { input: '- An an\n- Bn bn', mayTick: [], markdown: true },
  { input: 'अक्षर: An an, Bn bn.', mayTick: [] },
  { input: 'Say an an, then say a.', mayTick: [] },
  { input: 'An an apple fell.', mayTick: [] },
  // Task F10 (owner decision 2026-10-27): a doubling off the slip allowlist, repeated so it forms its own batch card
  // in any case or spacing, starts with every place unticked; it is often grammar.
  { input: 'He said THAT THAT was fine. I knew THAT THAT was wrong.', mayTick: [] },
  { input: 'HE HAD HAD ENOUGH. SHE HAD HAD LUNCH.', mayTick: [] },
  { input: 'He Had Had Enough. She Had Had Lunch.', mayTick: [] },
  { input: 'He had  had enough. She had  had lunch.', mayTick: [] },
  // Right fixes outside the closed set start unticked too (Task F8; F8 re-review 7, M-5).
  { input: 'I think teh plan works.', mayTick: [] },
  { input: 'It rained today. we left early.', mayTick: [] },
  // F4 re-review 3, I-1 to I-3: an abbreviation's dot, part of a word, an initialism, a short word.
  { input: 'Meet at 5 pm. tomorrow please.', mayTick: [] },
  { input: 'Jan. was cold.', mayTick: [] },
  { input: 'Bros. came home.', mayTick: [] },
  { input: 'Hon. minister came.', mayTick: [] },
  { input: 'Wt. and ht. noted.', mayTick: [] },
  { input: 'Qty. ten is fine.', mayTick: [] },
  { input: 'Amt. due is ten.', mayTick: [] },
  { input: 'Ave. road is long.', mayTick: [] },
  { input: 'He studied at an Engg. college.', mayTick: [] },
  { input: 'It rained today. Engg. college is near.', mayTick: [] },
  { input: 'It rained today. Ph.D. students came.', mayTick: [] },
  { input: 'The proof went to the HoD. Ph.D. scholars wait.', mayTick: [] },
  { input: 'She has a Ph.D. in physics.', mayTick: [] },
  { input: 'It is a ewe lamb.', mayTick: [] },
  { input: 'Buy an lpg cylinder.', mayTick: [] },
  { input: 'He is an rss member.', mayTick: [] },
  { input: 'He got an sms today.', mayTick: [] },
  { input: 'See an hr manager.', mayTick: [] },
  { input: 'He is an mla now.', mayTick: [] },
  { input: 'He is an nri now.', mayTick: [] },
  { input: 'File an fir today.', mayTick: [] },
  { input: 'The variable i is set.', mayTick: [] },
  { input: 'Use tabs\t\there please.', mayTick: [] },
  // F4 re-review 3: kinds the user opted into in Settings (they start unticked, owner decision 2026-10-25).
  { input: 'We expect price competition to increase.', mayTick: [] },
  { input: 'Error rates return to normal.', mayTick: [] },
  { input: 'Small things added up to nearly ₹4,00,000.', mayTick: [] },
  { input: 'We tried to identify how people described heat.', mayTick: [] },
  { input: 'It has longer-term effects such as kidney damage.', mayTick: [] },
  { input: 'Please adjust timeout values.', mayTick: [] },
  { input: 'Add chopped green chillies.', mayTick: [] },
  { input: 'Forty per cent of payments were late.', mayTick: [] },
  { input: 'When Rohan first introduced us, we laughed.', mayTick: [] },
  { input: 'They grow soybean, cotton and pigeon pea.', mayTick: [] },
  // F5 re-review 4, I-1: an article before a word whose sound its spelling doesn't tell.
  { input: 'Police found an unidentified man near the gate.', mayTick: [] },
  { input: 'An unidentified caller rang twice.', mayTick: [] },
  { input: 'It was an unidentifiable object.', mayTick: [] },
  { input: 'The sea urchin is an urchin of the reef.', mayTick: [] },
  { input: 'It was done with an utmost care.', mayTick: [] },
  { input: 'He has an urticaria rash.', mayTick: [] },
  { input: 'The new rules are an onerous burden.', mayTick: [] },
  { input: 'She filled a ewer with water. He keeps a ewes flock.', mayTick: [] },
  // I-2: a capital after a long lowercase abbreviation or a spaced ellipsis.
  { input: 'See page four, contd. from the last issue.', mayTick: [] },
  { input: 'He works in the deptt. of physics.', mayTick: [] },
  { input: 'Ask the admin. team about it.', mayTick: [] },
  { input: 'See the illus. below for details.', mayTick: [] },
  { input: 'Use the abbrev. form here.', mayTick: [] },
  { input: 'Hmm . . . yes, we can.', mayTick: [] },
  { input: 'Wait . . . then go.', mayTick: [] },
  // I-3: a capital after "!" inside a sentence, or on an inline list label.
  { input: 'I use Yahoo! mail every day.', mayTick: [] },
  { input: 'He won on Jeopardy! last night.', mayTick: [] },
  { input: 'We played Yahtzee! and Boggle! today.', mayTick: [] },
  { input: 'We use Yahoo! for search.', mayTick: [] },
  { input: 'a) the first point. b) the second point.', mayTick: [] },
  // I-4: "i" → "I" in a list label, maths or code.
  { input: 'Options: (i) first, (ii) second.', mayTick: [] },
  { input: 'Part i and part ii are done.', mayTick: [] },
  { input: 'Let i be an index and x = i + 1.', mayTick: [] },
  { input: 'for i in range(10): print(i)', mayTick: [] },
  // M-4: dot runs.
  { input: 'It is fine.. done now.', mayTick: [] },
  { input: 'Wait.... there it is.', mayTick: [] },
  { input: 'Use ... here please.', mayTick: [] },
  // M-5: punctuation spacing in code-like text and in a Markdown table cell.
  { input: 'Call foo(a ,b) and x = y ,z today.', mayTick: [] },
  { input: '| a ,b | c |\n|---|---|\n| d | e |', mayTick: [], markdown: true },
  // F6 re-review 5, I-1: a capital "A" mid-sentence is a letter label or an initial, not an article.
  { input: 'Note: A apple is red.', mayTick: [] },
  { input: 'We leased a Class A office in Pune last year.', mayTick: [] },
  { input: 'Burglary is a Category A offence in that county.', mayTick: [] },
  { input: 'He was treated for a Hepatitis A infection last spring.', mayTick: [] },
  { input: 'She is a Type A individual who plans everything.', mayTick: [] },
  { input: 'Report any Schedule A income on page two.', mayTick: [] },
  { input: 'Meet me at the Terminal A exit near gate 4.', mayTick: [] },
  { input: 'We discussed the Plan A option at length.', mayTick: [] },
  { input: 'Use the Block A entry after six.', mayTick: [] },
  { input: 'Every Grade A item ships today.', mayTick: [] },
  { input: 'Room A order forms are here.', mayTick: [] },
  { input: 'Approved by Priya A officer in charge.', mayTick: [] },
  { input: 'Submitted by Kavya A Assistant Professor of Physics.', mayTick: [] },
  { input: 'Reviewed by Arun A Engineer on 2 May.', mayTick: [] },
  { input: 'How To Become A Engineer In India', mayTick: [] },
  { input: 'We stayed with the An family in Seoul.', mayTick: [] },
  { input: 'Dr. An home visits are on Fridays.', mayTick: [] },
  // F6 re-review 5, I-2: a lowercase "a" as a variable before a word that is also a verb.
  { input: 'He ate a apple, so why does a equal b?', mayTick: [] },
  { input: 'Why does a equal b in this proof?', mayTick: [] },
  { input: 'Will a increase if b falls?', mayTick: [] },
  { input: 'Can a end before b starts?', mayTick: [] },
  { input: 'Let a equal 5 and b equal 3.', mayTick: [] },
  { input: 'If x and a increase together, the sum rises.', mayTick: [] },
  { input: 'Then a must exceed b, so a only grows.', mayTick: [] },
  { input: 'Let *a* equal 5, and let a equal b.', mayTick: [], markdown: true },
  // F6 re-review 5, M-2: "a" in Spanish, Portuguese or Italian is a preposition or an article, not English "a".
  { input: 'Fui a animal planet y luego a idea nueva.', mayTick: [] },
  { input: 'Voy a ir mañana.', mayTick: [] },
  { input: 'Vou a escola amanhã.', mayTick: [] },
  { input: 'Le dije que a idea era mala.', mayTick: [] },
  { input: 'Tenemos a idea muy buena para mañana.', mayTick: [] },
  { input: 'Ela comprou a apple para o almoço.', mayTick: [] },
  // Task F20 item 1: a doubling inside a command is the command's text, not a slip.
  { input: 'echo the the > notes.txt', mayTick: [] },
  { input: 'sudo echo of of', mayTick: [] },
  // Task F21 item A (F20 adversarial review I-1, M-16, M-19; the owner's item A): nothing in a command starts ticked.
  { input: 'cat <<EOF > words.txt\nthe the\nEOF', mayTick: [] },
  { input: 'make the the', mayTick: [] },
  { input: 'cat <<EOF > config.yml\nname: my app\nport:  8080\nretries: 3 , 4\nEOF', mayTick: [] },
  { input: 'until sudo docker pull ${SRC}; do\n  sleep 5\ndone', mayTick: [] },
  { input: '# Install docker if not present\nsudo apt-get install -y docker.io', mayTick: [] },
  { input: 'gh secret set FOO --body "$X"', mayTick: [] },
  { input: "aws ec2 describe-instances --query 'Reservations[].Instances[].{\nId:InstanceId; Type:InstanceType;\nState:State.Name}' --output table", mayTick: [] },
  { input: 'Scripts use sudo su ubuntu to switch user.', mayTick: [] },
  { input: 'Use the docker CLI. The docker daemon must run. until sudo docker pull ${SRC}; do sleep 5; done', mayTick: [] },
  { input: 'if true; then echo hi; fi', mayTick: [] },
  { input: 'for i in 1 2 3; do echo $i; done', mayTick: [] },
  { input: 'for f in *.log; do gzip $f; done', mayTick: [] },
  { input: 'node app.js > out.log 2>&1', mayTick: [] },
  { input: 'tee /etc/app.conf <<EOF\nhost = localhost\nlog level = debug\nEOF', mayTick: [] },
  { input: 'node index.js --port 3000', mayTick: [] },
  { input: 'brew install jq\ncargo build\ngo run .\ntar xzf a.tgz\nunzip a.zip', mayTick: [] },
  { input: 'build:\n\tgo build -o bin/app ./cmd/app\n\ttest:  lint\n\tgo test ./...', mayTick: [] },
  { input: 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: web\nspec:\n  replicas:  3', mayTick: [] },
  { input: "aws ec2 describe-instances \\\n  --filters \"Name=tag:Env,Values=prod\" \\\n  --query 'Reservations[].Instances[].{\n    id: InstanceId;\n    type: InstanceType;\n  }'", mayTick: [] },
  { input: "aws ec2 describe-instances \\\n  --region ap-south-1 \\\n  --query 'Reservations[].Instances[].{Id:InstanceId; Type:InstanceType}' \\\n  --output table", mayTick: [] },
  { input: 'sudo docker run -d \\\n  -p 80:80 \\\n  nginx:latest', mayTick: [] },
  // Review M-17.
  { input: 'Steps:\n1. until sudo docker pull ${SRC}; do sleep 5; done\n2. # install docker if not present\n3. gh secret set FOO --body "$X"', mayTick: [] },
  { input: 'gh auth login', mayTick: [] },
  // Task F21 item E (review M-18).
  { input: 'Attach sg-0a1b2c3d4e5f67890 to i-0abcd1234efgh5678 now.', mayTick: [] },
  { input: 'The role is arn:aws:iam::123456789012:role/deploy-role-prod and the bucket arn:aws:s3:::my-bucket-logs.', mayTick: [] },
];

/** Invisible characters sprinkled at random between ASCII characters. */
const RANDOM_JUNK = [0x200b, 0x2060, 0xfeff, 0x00ad, 0x200c, 0x200d, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x180e];

/** Mulberry32: a small seeded generator, so every run builds the same documents. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One character of a paragraph with its markers. */
interface Char {
  ch: string;
  trap?: number;
  fix?: number;
  right?: string;
  junk?: boolean;
}

/** `[[`, `]]`, `<<wrong|right>>` or `{{hex}}` at the start of `rest`. */
const MARKER = /^(?:\[\[|\]\]|<<([^|]*)\|([^>]*)>>|\{\{([0-9A-F]{4})\}\})/;

let markerIds = 0;

function parseTemplate(template: string): Char[] {
  const out: Char[] = [];
  let trap: number | undefined;
  for (let i = 0; i < template.length; ) {
    const m = MARKER.exec(template.slice(i));
    if (!m) {
      out.push({ ch: template[i], trap });
      i++;
      continue;
    }
    i += m[0].length;
    if (m[0] === '[[') trap = ++markerIds;
    else if (m[0] === ']]') trap = undefined;
    else if (m[3]) out.push({ ch: String.fromCharCode(parseInt(m[3], 16)), trap, junk: true });
    else {
      const fix = ++markerIds;
      for (const ch of m[1]) out.push({ ch, fix, right: m[2] });
    }
  }
  return out;
}

const ASCII_TEXT = /^[A-Za-z ]$/;

/** Inserts one random invisible character between two ASCII letters or spaces; it joins a trap or fix it lands inside. */
function sprinkleJunk(chars: Char[], random: () => number): void {
  const slots: number[] = [];
  for (let i = 1; i < chars.length; i++) if (ASCII_TEXT.test(chars[i - 1].ch) && ASCII_TEXT.test(chars[i].ch)) slots.push(i);
  if (slots.length === 0) return;
  const at = slots[Math.floor(random() * slots.length)];
  const before = chars[at - 1];
  const after = chars[at];
  const ch = String.fromCharCode(RANDOM_JUNK[Math.floor(random() * RANDOM_JUNK.length)]);
  const trap = before.trap === after.trap ? before.trap : undefined;
  const fix = before.fix === after.fix ? before.fix : undefined;
  chars.splice(at, 0, { ch, trap, fix, right: fix === undefined ? undefined : before.right, junk: true });
}

function toParagraph(chars: Char[]): StressParagraph {
  const text = chars.map((c) => c.ch).join('');
  const traps: StressParagraph['traps'] = [];
  const fixes: StressParagraph['fixes'] = [];
  const junk = new Set<number>();
  chars.forEach((c, i) => {
    if (c.junk) junk.add(i);
    if (c.trap !== undefined) {
      const last = traps.at(-1);
      if (last && chars[i - 1]?.trap === c.trap) last.end = i + 1;
      else traps.push({ start: i, end: i + 1 });
    }
    if (c.fix !== undefined) {
      const last = fixes.at(-1);
      if (last && chars[i - 1]?.fix === c.fix) last.end = i + 1;
      else fixes.push({ start: i, end: i + 1, right: c.right! });
    }
  });
  return { text, traps, fixes, junk };
}

/**
 * `count` slots of paragraphs, the same for the same seed: mostly 3–6 sentences mixing traps, fillers and planted
 * errors, some starting with a list label, some wholly Hindi or Bengali, and every 20th a key–value block of
 * one-line paragraphs. Every trap template is used once
 * before any is used twice. About a third of the sentences get a random invisible character.
 */
export function stressDocument(seed: number, count: number): StressParagraph[] {
  const random = seeded(seed);
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  // Traps are dealt like cards, so every one appears before any appears twice.
  let trapDeck: string[] = [];
  const nextTrap = () => {
    if (trapDeck.length === 0) trapDeck = [...TRAPS];
    return trapDeck.splice(Math.floor(random() * trapDeck.length), 1)[0];
  };
  const paragraphs: StressParagraph[] = [];
  for (let p = 0; p < count; p++) {
    if (p % 20 === 10) {
      paragraphs.push(...KEY_VALUE_BLOCK.map((line) => toParagraph(parseTemplate(line))));
      continue;
    }
    if (p === 15) {
      paragraphs.push(...runbookParagraphs());
      continue;
    }
    if (random() < 0.1) {
      paragraphs.push(toParagraph(parseTemplate(pick(INDIC))));
      continue;
    }
    const chars: Char[] = random() < 0.15 ? parseTemplate(pick(LIST_LABELS)) : [];
    const sentences = 3 + Math.floor(random() * 4);
    for (let s = 0; s < sentences; s++) {
      const r = random();
      const sentence = parseTemplate(r < 0.6 ? nextTrap() : r < 0.85 ? pick(FILLERS) : pick(PLANTED));
      if (random() < 0.35) sprinkleJunk(sentence, random);
      if (chars.length > 0 && !/\s$/.test(chars[chars.length - 1].ch)) chars.push({ ch: ' ' });
      chars.push(...sentence);
    }
    paragraphs.push(toParagraph(chars));
  }
  return paragraphs;
}

/** Number of sentences in the documents, for the report: one per sentence end in Latin or Indic script. */
export function sentenceCount(paragraphs: StressParagraph[]): number {
  return paragraphs.reduce((n, p) => n + (p.text.match(/[.?!।](?=[”"]?(\s|$))/g)?.length ?? 0), 0);
}
