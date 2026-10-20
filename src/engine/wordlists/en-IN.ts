/**
 * Common Indian-English words that Harper's dictionary lacks. They are ordinary vocabulary for Indian
 * writers whatever spelling variant they use, so the linter loads them for every variant. Lowercase;
 * inflections are listed where writers use them (plurals, -ed/-ing). Proper nouns (names, places)
 * are deliberately excluded: those are handled by the fact lock, not by the dictionary.
 */
const CIVIC = `
panchayat panchayats sarpanch sarpanches gram sabha sabhas tehsil tehsils tehsildar tehsildars taluka talukas
taluk taluks zilla parishad parishads mandal mandals patwari patwaris lekhpal talathi talathis
collectorate collectorates nagar nigam palika anganwadi anganwadis ashram ashrams lok rajya vidhan
mukhiya pradhan pradhans gramsevak gramsevaks janpad mohalla mohallas basti bastis chowk chowks
`;

const MONEY = `
lakh lakhs crore crores paise paisa rupee rupees anna annas
`;

const FOOD = `
dal dals daal roti rotis chapati chapatis paratha parathas thepla theplas poha upma idli idlis dosa dosas
vada vadas pav bhaji sev misal biryani biryanis pulao khichdi sambar rasam chutney chutneys raita pakora pakoras
samosa samosas jalebi jalebis ladoo laddoo laddoos ladoos halwa kheer chai masala masalas ghee paneer atta maida
besan rava sooji suji jaggery gur ragi jowar bajra nachni methi palak aloo gobi bhindi lassi chaas buttermilk
chikki thali thalis tiffin tiffins dabba dabbas dhaba dhabas kirana mithai namkeen papad papads achaar
`;

const PLACES = `
nullah nullahs nala nalas borewell borewells tubewell tubewells chawl chawls ghat ghats haveli havelis
godown godowns mandi mandis haat haats bazaar bazaars wada wadas gully gullies nagar
`;

const COMMON = `
prepone prepones preponed preponing desilting desilt desilted siltation jugaad sarkari babu babus
kharif rabi zaid sangeet mehendi mehndi baraat pandal pandals puja pujas aarti prasad darshan
didi bhaiya bhai kaka kaki tai ji dada dadi nana nani beta crorepati lakhpati
kurta kurtas dupatta dupattas saree sarees sari lungi dhoti
autorickshaw autorickshaws rickshaw rickshaws tempo tempos
annexure annexures stepney cooperative cooperatives headmistress
matric intermediate
`;

const FESTIVALS = `
diwali deepavali holi navratri dussehra durga ganeshotsav ganpati onam pongal bihu eid ramzan lohri
baisakhi makar sankranti raksha bandhan janmashtami
`;

export const EN_IN_WORDS: string[] = [
  ...new Set(
    [CIVIC, MONEY, FOOD, PLACES, COMMON, FESTIVALS]
      .join(' ')
      .split(/\s+/)
      .filter((w) => w.length > 0),
  ),
];
