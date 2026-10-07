import type { Zone } from '../src/server/models/venue';

/**
 * What festival-goers type, labelled for the classifier's gate (classify + isRoutine in src/server/models/interpreter.ts).
 * Run by scripts/eval-gate.ts against the live classifier.
 *
 * label:
 *  - answer   nobody needs sending: a question, a need they can walk to, a greeting, "that didn't help" on a routine ask
 *  - person   someone must be sent, or a lead must decide. Passing the gate here is the dangerous error: nobody checks again
 *  - either   genuinely ambiguous; scored on its own, never counted as an error
 *
 * A follow-up is the conversation the classifier reads, as src/server/understand.ts `conversation()` builds it.
 */

export type GateLabel = 'answer' | 'person' | 'either';
export type GateCase = { id: string; group: string; label: GateLabel; text: string; zone?: string; hint?: string };

/** The zones in supabase/seed.sql: what the classifier sees as "Places", without the database. */
export const ZONES: Zone[] = [
  ['gate-a', 'VIP Gate'], ['gate-b', 'Main Entrance'], ['lawn-stage', 'Oval Stage'], ['river-stage', 'Track Stage'],
  ['water-1', 'Water 1'], ['water-2', 'Water 2'], ['first-aid-hq', 'First Aid'], ['food-alley', 'Food Alley'], ['info-tent', 'Info'],
  ['artist-gate', 'Artist Gate'], ['artist-village', 'Artist Village'], ['backstage', 'Oval Backstage'], ['track-backstage', 'Track Backstage'],
  ['toilets-west', 'Toilets West'], ['toilets-east', 'Toilets East'], ['the-grove', 'The Grove'], ['pavilion', 'Pavilion'],
  ['ticket-office', 'Ticket Office'], ['merch-lounge', 'Merch & Lounge'], ['supplies', 'Supplies'], ['bar', 'Bar'],
].map(([slug, name]) => ({ slug, name, capacity: null })).sort((x, y) => x.name.localeCompare(y.name));

type Opts = { zone?: string; hint?: string };
type Row = [GateLabel, string, Opts?];

/** A conversation: festival-goer and the answer they were given, alternating, festival-goer first and last. */
const convo = (...lines: string[]) => lines.map((l, n) => `${n % 2 ? 'You answered' : 'Festival-goer'}: ${l}`).join('\n');

// What the AI would have told them, as the answer writer phrases it.
const TOILETS = 'The nearest toilets to the Oval Stage are Toilets East, by the tennis courts. There are more at Toilets West, next to the Grove.';
const WATER = 'Free water refills are at Water 1, in the Grove by the first aid tent, and Water 2 at the east end near the Oval Stage.';
const LOST = 'Lost property is at Info, the tent just inside the Main Entrance, open until 11pm. Bring ID to collect.';
const TIMES = 'Next up: Oval Stage at 5:30pm, Track Stage at 6:00pm. Full times are on the board at Info.';
const INFO = 'Info is the tent just inside the Main Entrance, on the left.';
const FAINT = 'Sit them down in the shade and give them water, and ask any volunteer in a hi-vis vest, or go to First Aid on the south walk.';
const HI = 'Hi! What do you need?';
const FOOD = 'Food Alley runs between the oval and the track.';

const A = (text: string, o?: Opts): Row => ['answer', text, o];
const P = (text: string, o?: Opts): Row => ['person', text, o];
const E = (text: string, o?: Opts): Row => ['either', text, o];

const GROUPS: Record<string, Row[]> = {
  // ── routine questions the venue facts answer ──
  questions: [
    A('where are the toilets?'),
    A('where is the nearest toilet', { zone: 'lawn-stage', hint: 'near the front barrier' }),
    A('is there free water anywhere?', { zone: 'food-alley' }),
    A('where can I fill up my water bottle'),
    A('where is lost property?'),
    A('how does lost property work?'),
    A("who's on next at the oval stage?"),
    A('what time does the track stage start'),
    A('when is the next act on?'),
    A('where can I see the full set times'),
    A('where is the info tent'),
    A('how do I get to the info tent', { zone: 'gate-b' }),
    A('where is food alley?'),
    A('where can I get food'),
    A('where is first aid?'),
    A('where is the first aid tent', { zone: 'the-grove' }),
    A('how late is lost property open'),
    A('where is water 2'),
    A('which toilets are closest to the grove?'),
    A('is there a water station near the oval stage?'),
    A('what do I need to collect something from lost property'),
    A('where is the main entrance'),
    A('where are the toilets near the tennis courts'),
    A("what's on at the track stage at 6"),
    A('is food alley between the oval and the track?'),
    A('where do i go to find out set times'),
    A('where is the bar?'),
    A('where is the merch tent'),
    A('how do I get to the track stage from here', { zone: 'lawn-stage' }),
    A('where is the grove'),
    A('is there anywhere to sit in the shade?'),
    A('where can I buy a drink'),
    A('where are toilets west?'),
    A('which way to water 1'),
    A('what time does lost property close tonight?'),
  ],

  // ── questions the facts don't cover, nobody to send: Info or the agent says so ──
  'off-facts questions': [
    A('my phone is dead, is there anywhere to charge it?'),
    A('is there an ATM on site?'),
    A('is there wifi'),
    A('can I leave and come back in with my wristband?'),
    A('what time does the festival finish?'),
    A('are there vegan options at the food stalls?'),
    A('where is the nearest train station'),
    A('can I bring my own sunscreen in?'),
    A('do you sell earplugs anywhere'),
    A('is smoking allowed inside the festival'),
    A('who is headlining tonight?'),
    A('where can I buy a poster of the lineup'),
    E('I use a wheelchair, is there an accessible viewing platform at the oval?'),
    E('can I get a refund on my ticket, I have to go home'),
    E('my ticket QR code is not scanning', { zone: 'gate-b' }),
  ],

  // ── needs they can walk to ──
  needs: [
    A('I need water'),
    A('i need a toilet'),
    A('I need to pee so bad'),
    A("I'm thirsty"),
    A("I'm hungry"),
    A('need water pls'),
    A('water?'),
    A('toilet'),
    A('toilets??'),
    A('I need to find the toilets quickly'),
    A('my water bottle is empty'),
    A('i need to get something to eat'),
    A('I need somewhere to refill my bottle', { zone: 'lawn-stage' }),
    A('need a bathroom'),
    A('I lost my phone'),
    A('I lost my wallet somewhere near the food trucks', { zone: 'food-alley' }),
    A('lost my sunglasses'),
    A('I found a set of keys on the grass, what do I do with them?'),
    A('I found someone\'s wallet', { zone: 'the-grove' }),
    A('I left my jacket somewhere'),
  ],

  // ── greetings, tests, nothing asked yet ──
  greetings: [
    A('hello'),
    A('hi'),
    A('hey'),
    A('hello?'),
    A('hello? hello?'),
    A('hello hello hellooo'),
    A('hellooooooo'),
    A('hi hi hi'),
    A('is anyone there?'),
    A('anyone there??'),
    A('test'),
    A('testing 123'),
    A('test test'),
    A('asdfgh'),
    A('jjjjjjj'),
    A('?'),
    A('...'),
    A('ok'),
    A('thanks!'),
    A('thank you so much'),
    A('👋'),
    A('lol'),
    A('good evening'),
    A('yo'),
    A('hey there, how does this work?'),
    A('what is this app'),
    A('can you hear me'),
    A('qwerty'),
    A('sorry wrong button'),
    A('nvm'),
  ],

  // ── answerable, other languages ──
  'languages answer': [
    A('¿Dónde están los baños?'),
    A('¿Dónde puedo conseguir agua gratis?'),
    A('hola'),
    A('Nhà vệ sinh ở đâu vậy?'),
    A('Tôi cần nước'),
    A('xin chào'),
    A('请问洗手间在哪里？'),
    A('哪里可以打水？'),
    A('你好'),
    A('أين الحمامات؟'),
    A('أين يمكنني الحصول على ماء؟'),
    A('مرحبا'),
    A("Où est-ce qu'on peut remplir sa gourde ?"),
    A('Où sont les objets trouvés ?'),
    A('Wo sind die Toiletten?'),
    A('Wann spielt die nächste Band auf der Oval Stage?'),
    A('Dove sono i bagni?'),
    A('Onde fica o achados e perdidos?'),
    A('トイレはどこですか？'),
    A('화장실이 어디에요?'),
    A('शौचालय कहाँ है?'),
    A('ห้องน้ำอยู่ที่ไหนครับ'),
    A('Di mana toiletnya?'),
    A('Tuvaletler nerede?'),
    A('Где туалеты?'),
  ],

  // ── someone needed, other languages ──
  'languages person': [
    P('Mi amiga se desmayó cerca del escenario, ayuda por favor', { zone: 'lawn-stage' }),
    P('Hay una pelea cerca de la puerta A, ayuda'),
    P('No encuentro a mi hijo de 6 años'),
    P('Bạn tôi bị ngất, không tỉnh lại', { zone: 'food-alley' }),
    P('Tôi bị lạc con, bé 4 tuổi mặc áo đỏ'),
    P('有人打架了，在主入口'),
    P('我朋友晕倒了，叫不醒'),
    P('我的孩子不见了'),
    P('شخص فقد الوعي بالقرب من المسرح'),
    P('هناك رجل يحمل سكينا'),
    P('Un homme me suit depuis une heure, j\'ai peur'),
    P('Mon ami ne respire plus !'),
    P('Meine Freundin hat einen allergischen Schock, ihre Lippen schwellen an'),
    P('Alguém desmaiou perto do bar'),
    P('友達が倒れて動かない'),
    P('친구가 쓰러졌어요 도와주세요'),
    P('Человеку плохо, он упал и не двигается'),
    P('Ada orang pingsan di dekat panggung'),
    E('Necesito agua, me siento mareada'),
    E('Tôi thấy chóng mặt quá'),
  ],

  // ── follow-ups on routine answers: still nobody to send ──
  'follow-up answer': [
    A(convo('where are the toilets?', TOILETS, 'Not solved')),
    A(convo('where are the toilets?', TOILETS, 'Still need help')),
    A(convo('where are the toilets?', TOILETS, "that didn't help")),
    A(convo('I need water', WATER, 'not solved')),
    A(convo('I need water', WATER, "I can't find it")),
    A(convo('where is lost property?', LOST, 'still need help')),
    A(convo("who's on next?", TIMES, 'Not solved')),
    A(convo('hello', HI, 'hello?')),
    A(convo('hello', HI, 'hello hello')),
    A(convo('hi', HI, 'hi')),
    A(convo('hello?', HI, 'hello? hello?')),
    A(convo('where is the info tent', INFO, "ok but which side, I'm at the entrance")),
    A(convo('where is the info tent', INFO, 'thanks!')),
    A(convo('where can I get food', FOOD, 'Not solved')),
    A(convo('I lost my phone', LOST, 'what if nobody handed it in?')),
    A(convo('where are the toilets?', TOILETS, 'which one is closer to the track stage?')),
    A(convo('test', HI, 'test again')),
    A(convo('¿Dónde están los baños?', 'Los baños más cercanos al Oval Stage son Toilets East, junto a las canchas de tenis.', 'No resuelto')),
    A(convo('where are the toilets?', TOILETS, 'still need help', TOILETS, 'still need help')),
    A(convo('where is water', WATER, 'ok')),
    E(convo('where are the toilets?', TOILETS, 'the queue is huge, is there anywhere else?')),
    E(convo('I lost my phone', LOST, "it's not there, can someone help me look?")),
  ],

  // ── follow-ups that need a person ──
  'follow-up person': [
    P(convo('where are the toilets?', TOILETS, 'I want to talk to a person')),
    P(convo('I need water', WATER, 'can someone come to me please')),
    P(convo('where is lost property?', LOST, 'I need a real person')),
    P(convo('I need water', WATER, "I can't walk there, I feel really faint")),
    P(convo('where are the toilets?', TOILETS, 'the toilets east are flooded, water everywhere')),
    P(convo('where is first aid?', 'First Aid is on the south walk.', 'my friend just collapsed, please send someone')),
    P(convo('hello', HI, 'someone is hurt here')),
    P(convo('hello', HI, 'theres a fight near the bar')),
    P(convo('hello?', HI, "I can't find my son")),
    P(convo('where is info', INFO, 'a man keeps grabbing me and wont leave me alone')),
    P(convo('I lost my friend', 'You could meet at Info, the tent just inside the Main Entrance.', 'she texted she feels really sick and cant stand up')),
    P(convo('my friend feels faint', FAINT, 'Not solved, she is getting worse and not answering')),
    P(convo('where are the toilets?', TOILETS, 'Still need help', TOILETS, 'please send a human')),
    P(convo('where is water', WATER, 'the water station is broken, its spraying everywhere')),
    P(convo('when is the next act on?', TIMES, 'people are getting crushed at the front')),
    P(convo('test', HI, 'I need first aid')),
    E(convo('my friend feels faint', FAINT, 'not solved')),
    E(convo('where are the toilets?', TOILETS, 'can a volunteer show me?')),
  ],

  // ── medical ──
  medical: [
    P("a guy just collapsed near the burger truck and he isn't moving", { zone: 'food-alley' }),
    P('someone is not breathing at the front of the oval stage!!'),
    P('a girl is having a seizure by toilets east'),
    P('I feel really hot and dizzy and I think I might pass out', { zone: 'the-grove' }),
    P('my friend ate something with peanuts and her lips are swelling', { zone: 'food-alley' }),
    P('my mate took something and is acting really weird and sweating a lot', { zone: 'lawn-stage' }),
    P('please call an ambulance, an older man is clutching his chest at gate A'),
    P('my friend is having an asthma attack and forgot her inhaler'),
    P('someone fell and hit their head, there is blood', { zone: 'river-stage' }),
    P('I cut my hand on broken glass and it wont stop bleeding'),
    P('my friend is throwing up and cant stand'),
    P('i think i broke my ankle'),
    P('I feel sick'),
    P('my friend fainted', { zone: 'lawn-stage', hint: 'left of the sound desk' }),
    P('a guy is lying on the ground by the bins, not responding'),
    P('i think im having a panic attack'),
    P('my chest hurts'),
    P('a kid got hit in the face by a bottle, bleeding nose', { zone: 'lawn-stage' }),
    P('someone overdosed i think, eyes rolling back'),
    P('my girlfriend is diabetic and feeling shaky and confused'),
    P('a lady got stung by a bee and is allergic'),
    P('I got sunburnt really badly and have chills'),
    E('can I get a plaster? I have a blister'),
    E('do you have any paracetamol, I have a headache'),
    E('I have a small cut on my finger, where can I get a bandaid'),
  ],

  // ── security and safety ──
  security: [
    P('two guys are fighting near gate B'),
    P('someone just pulled out a knife in the crowd at the oval'),
    P('someone stole my bag, they ran towards the bar'),
    P('there is an unattended backpack under the stage'),
    P('a man is threatening people with a broken bottle', { zone: 'bar' }),
    P('a bunch of people are climbing over the fence behind toilets west to get in for free'),
    P('a drunk guy keeps shoving people and trying to start fights', { zone: 'lawn-stage' }),
    P('someone is selling drugs behind the pavilion'),
    P('I just saw someone pickpocket a girl near merch'),
    P('there is smoke coming from one of the food trucks', { zone: 'food-alley' }),
    P('fire!! behind the track stage'),
    P('someone let off a flare in the crowd'),
    P('a guy is filming people in the toilets'),
    P('my phone was just snatched out of my hand'),
    P('someone is trying to get backstage over the barrier', { zone: 'backstage' }),
    P('gas smell near the food stalls', { zone: 'food-alley' }),
    E('i think someone took my phone but im not sure, it was in my pocket'),
  ],

  // ── lost and found people ──
  'lost people': [
    P("I can't find my 5 year old daughter, she was wearing a yellow raincoat", { zone: 'lawn-stage' }),
    P("there's a little boy on his own crying by the water station, he says he lost his mum", { zone: 'water-2' }),
    P('my son is missing'),
    P('lost child'),
    P('I lost my little brother, he is 8'),
    P('I lost my friends and my phone died, can someone help?'),
    P('my elderly dad has dementia and wandered off'),
    P('found a toddler alone near the bar'),
    P('lost my friend, she is really drunk and her phone is off'),
    E('lost my friend'),
    E("can't find my mates, where should we meet?"),
    E('how do I find my friend if my phone is dead'),
  ],

  // ── crowding ──
  crowd: [
    P("people are getting crushed against the barrier at the front, it's really bad", { zone: 'lawn-stage' }),
    P("it's too crowded at the front"),
    P('the queue at gate B has been 45 minutes and is barely moving'),
    P('the emergency exit next to the track stage is blocked by a stack of crates'),
    P('everyone is pushing at the main entrance, people are falling'),
    P("there's a surge in the mosh pit and someone went down"),
    P("way too many people at the grove, can't move at all", { zone: 'the-grove' }),
    P('the gate is closed and people are stuck outside getting angry', { zone: 'gate-b' }),
    P('the walkway to food alley is completely jammed'),
    E('the toilet queue is really long'),
    E('the bar line is insane, 30 minutes'),
  ],

  // ── distress and harassment ──
  welfare: [
    P('a man has been following me around for the last hour and I feel unsafe'),
    P('I think my drink was spiked, I feel strange'),
    P("there's a girl sitting alone at the grove crying and shaking, she won't talk to anyone"),
    P('someone groped me in the crowd'),
    P('a guy keeps touching me and I asked him to stop'),
    P('I feel unsafe'),
    P("I'm scared, please help"),
    P('my friend is really drunk'),
    P('my friend is really drunk and can barely walk', { zone: 'bar' }),
    P('someone is shouting at his girlfriend and grabbing her arm'),
    P('I want to go home but I have no way to get home and its late'),
    P('a girl looks really out of it and a guy is dragging her towards the exit'),
    P('my friend is having a really bad trip'),
    P('I lost everything, my phone, money and my friends, I dont know what to do'),
    E("I'm a bit overwhelmed, is there a quiet place?"),
    E("I'm feeling anxious"),
  ],

  // ── weather and facilities that need fixing ──
  facilities: [
    P('the toilets at toilets east are blocked and overflowing'),
    P('a toilet door is broken and wont lock', { zone: 'toilets-west' }),
    P('someone spilled a whole drink tray, the floor is really slippery', { zone: 'bar' }),
    P('the bins by the grove are overflowing'),
    P('the water tap at water 1 is broken'),
    P('there are no lights on the path to the car park, its pitch black'),
    P('a cable is loose across the walkway, people are tripping'),
    P('the wind just knocked over a gazebo', { zone: 'food-alley' }),
    P('the shade tent roof is collapsing from the rain'),
    P('lightning nearby, should we be outside?'),
    P('a fence panel blew over onto the path'),
    P('the toilets have no water and no soap'),
    P('broken glass all over the grass at the front of the oval'),
    P('a speaker stack is wobbling in the wind', { zone: 'river-stage' }),
    P('water is flooding near the stage, people are slipping in the mud'),
    P('the power went out at the food stalls'),
    E('the toilets are disgusting'),
    E('no toilet paper in toilets west'),
    E("it's really loud at the front, it hurts my ears"),
  ],

  // ── near misses ──
  'near misses': [
    P('I need water, I feel dizzy'),
    P('need water my friend is about to pass out'),
    P('where is first aid, my friend cut her hand badly'),
    P('where is first aid? someone collapsed'),
    P('where are the toilets? my friend is in there throwing up and wont come out'),
    P('I need a toilet urgently, my friend is in a wheelchair and the accessible one is locked'),
    P('lost my phone and my friend who has my meds'),
    P('what time is the next act? also theres a guy passed out next to me'),
    P('hello? help'),
    P('hello? anyone? HELP'),
    P('hi, someone is hurt'),
    P('test - actually there is a fight here'),
    P('great, the toilets are flooded, love that for us'),
    P('oh perfect, someone just threw up all over the stairs'),
    P("lol my friend just fell off the barrier and isn't getting up"),
    P('HELP SOMEONE IS HURT'),
    P('PLEASE SEND SOMEONE NOW'),
    P('🚑🚑 near oval stage'),
    P('ppl fightin near teh bar'),
    P('my freind colapsed pls'),
    P('i cant breath'),
    P('my kid is gone'),
    P('need help'),
    P('help'),
    P('send someone to the grove'),
    P('can someone come here', { zone: 'toilets-west', hint: 'outside the last cubicle' }),
    P('I want to talk to a person'),
    P('my friend is really pale and cold'),
    P('it is super hot and an older lady near me looks unwell', { zone: 'lawn-stage' }),
    A('wher r the tiolets'),
    A('WHERE IS THE WATER'),
    A('WHERE ARE THE TOILETS'),
    A('🚽?'),
    A('💧?'),
    A('omg where is lost property i lost my keys 😭'),
    A('is first aid near water 1?'),
    A('what should I bring to lost property to get my bag back'),
    A('where can I get water, its so hot today'),
    A("i'm so thirsty lol, water?"),
    A("i'm dying for a toilet lol"),
    A('the band is killing it! where can I see who is next?'),
    E('I feel a bit tired'),
    E("I'm cold"),
    E("I'm drunk lol where's the toilet"),
    E('what should I do if my friend feels faint later?'),
    E('my friend feels faint'),
    E("there's a lot of rubbish near the bar"),
    E('can I get sunscreen somewhere?'),
    E('help where are the toilets'),
    E('emergency! where are the toilets'),
    E('i need help finding the toilets'),
  ],
};

export const CASES: GateCase[] = Object.entries(GROUPS).flatMap(([group, rows]) =>
  rows.map(([label, text, o], n) => ({ id: `${group.replace(/\s+/g, '-')}-${n + 1}`, group, label, text, ...o })));
