
// Entirely fictional fighters. Names are generated, records are simulated.
export const POOLS: Record<string, { first: string[]; last: string[] }> = {
  "United States": {
    first: ["Marcus", "Darnell", "Tyrese", "Colt", "Jalen", "Reggie", "Cody", "Andre", "Brock", "Malik", "Dante", "Wyatt"],
    last: ["Holloway", "Brightwell", "Okafor-Reyes", "Dunmore", "Castellan", "Pruitt", "Vance", "Larkin", "Stroud", "Maddox", "Ellery", "Boone"],
  },
  Mexico: {
    first: ["Ricardo", "Emilio", "Joaquín", "Rafael", "Alonso", "Hector", "Mateo", "Santiago", "Cristian", "Luis"],
    last: ["Valdivia", "Ochoa", "Beltrán", "Quintero", "Salcedo", "Montoya", "Ibarra", "Zamora", "Cervantes", "Arriaga"],
  },
  "United Kingdom": {
    first: ["Liam", "Declan", "Callum", "Ewan", "Rhys", "Tommy", "Alfie", "Jamie", "Connor", "Ellis"],
    last: ["Ashworth", "Pemberton", "Gallagher-Cole", "Thornley", "Whitlock", "Haddow", "Fenwick", "Garrity", "Penhale", "Ridley"],
  },
  Japan: {
    first: ["Kenji", "Haruto", "Ryota", "Daichi", "Sora", "Takumi", "Yuma", "Naoki", "Kaito"],
    last: ["Tanabe", "Morishita", "Kuroda", "Hayakawa", "Ishikari", "Matsuoka", "Saeki", "Nomura", "Okabe"],
  },
  Ukraine: {
    first: ["Oleksandr", "Taras", "Dmytro", "Bohdan", "Maksym", "Yaroslav", "Andriy", "Mykola"],
    last: ["Kovalenko", "Bondarchuk", "Tkachenko", "Hrytsenko", "Savchuk", "Lysenko", "Moroz", "Zinchenko"],
  },
  Philippines: {
    first: ["Rolando", "Jericho", "Arnel", "Benito", "Marlon", "Dionisio", "Ramil", "Efren"],
    last: ["Dela Vega", "Magsaysay", "Villanueva", "Pacheco", "Bautista", "Lacson", "Abad", "Soriano"],
  },
  Nigeria: {
    first: ["Chidi", "Emeka", "Tunde", "Ayodele", "Obinna", "Kelechi", "Segun", "Ifeanyi"],
    last: ["Adeyemi", "Nwosu", "Balogun", "Okonkwo", "Olatunji", "Eze", "Adebayo", "Ogunleye"],
  },
  Argentina: {
    first: ["Lucas", "Nicolás", "Facundo", "Matías", "Gonzalo", "Ezequiel", "Tomás", "Bruno"],
    last: ["Ferreyra", "Maidana-Ríos", "Sosa", "Benítez", "Paredes", "Acosta", "Quiroga", "Villalba"],
  },
  "Saudi Arabia": {
    first: ["Faisal", "Khalid", "Yazan", "Rakan", "Turki", "Nawaf", "Saud", "Abdulaziz"],
    last: ["Al-Harbi", "Al-Qahtani", "Al-Mutairi", "Al-Shehri", "Al-Dosari", "Al-Ghamdi", "Al-Zahrani", "Al-Otaibi"],
  },
  Germany: {
    first: ["Jonas", "Lukas", "Felix", "Maximilian", "Tobias", "Florian", "Stefan", "Niklas"],
    last: ["Brandt", "Kessler", "Hartmann", "Vogel", "Lindqvist", "Reinhardt", "Albrecht", "Sommer"],
  },
};
export const COUNTRIES = Object.keys(POOLS);
export const NICKS = ["The Hammer", "Ice", "El Toro", "Shadow", "Thunder", "The Surgeon", "Flash", "Casper", "Hurricane", "The Professor", "Blade", "Cobra", "Smoke", "Tank", "The Ghost", "Wildfire", "Magic", "Diesel", "Viper", "Nightmare", "Rocket", "Iron"];
export const CITIES: [string, string, string][] = [
  ["Las Vegas", "United States", "T-Mobile Arena"],
  ["New York", "United States", "Madison Square Garden"],
  ["Riyadh", "Saudi Arabia", "Kingdom Arena"],
  ["London", "United Kingdom", "O2 Arena"],
  ["Manchester", "United Kingdom", "Co-op Live"],
  ["Tokyo", "Japan", "Ryogoku Kokugikan"],
  ["Mexico City", "Mexico", "Arena CDMX"],
  ["Monterrey", "Mexico", "Arena Borregos"],
  ["Dallas", "United States", "American Airlines Center"],
  ["Berlin", "Germany", "Uber Arena"],
  ["Manila", "Philippines", "Mall of Asia Arena"],
  ["Kyiv", "Ukraine", "Palace of Sports"],
  ["Buenos Aires", "Argentina", "Luna Park"],
  ["Lagos", "Nigeria", "Teslim Balogun Stadium"],
];
export const HEIGHT_BASE = [155, 158, 162, 165, 168, 170, 173, 175, 177, 179, 181, 183, 185, 187, 189, 192, 196];
export const BELT = ["World Title", "Interim World Title", "Continental Title"];

export const pick = <T,>(r: () => number, a: T[]) => a[Math.floor(r() * a.length)];
export const gauss = (r: () => number) => {
  let u = 0, v = 0;
  while (u === 0) u = r();
  while (v === 0) v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
export const iso = (d: Date) => d.toISOString().slice(0, 10);


export const CITY_OF: Record<string, string[]> = {
  "United States": ["Philadelphia", "Houston", "Detroit", "Los Angeles", "Chicago", "Brooklyn", "Miami", "Oakland"],
  Mexico: ["Guadalajara", "Tijuana", "Culiacán", "Mexicali", "Puebla", "Monterrey"],
  "United Kingdom": ["Liverpool", "Sheffield", "Birmingham", "Glasgow", "Belfast", "Cardiff"],
  Japan: ["Osaka", "Nagoya", "Yokohama", "Fukuoka", "Sapporo"],
  Ukraine: ["Odesa", "Kharkiv", "Lviv", "Dnipro", "Zaporizhzhia"],
  Philippines: ["Cebu", "General Santos", "Davao", "Quezon City", "Bacolod"],
  Nigeria: ["Ibadan", "Abuja", "Port Harcourt", "Kano", "Benin City"],
  Argentina: ["Córdoba", "Rosario", "Mar del Plata", "Mendoza", "Quilmes"],
  "Saudi Arabia": ["Jeddah", "Dammam", "Medina", "Abha"],
  Germany: ["Hamburg", "Cologne", "Munich", "Leipzig", "Dortmund"],
};

export const GYM_A = ["Iron Hand", "Black Gate", "Golden Glove", "Ringcraft", "Steel City", "Northside", "Old Mill", "Southpaw Alley", "Red Corner", "Hammerlock", "Sunrise", "Foundry", "Canvas Club", "Rope & Chain", "Bayside", "Highline"];
export const GYM_B = ["Boxing Club", "Gym", "Fight Academy", "Athletic Club", "Boxing Academy", "Training Camp"];
export const PROMOTIONS = ["Marquee Fight Co.", "Crown Boxing Promotions", "Apex Ring Entertainment", "Unity Boxing", "Redline Promotions", "Vanguard Fight Night", "Meridian Boxing", "Lionheart Promotions", "Summit Sports Promotions", "Kingdom Cards", "Blueprint Boxing", "Harbor Fight Group"];
export const BODIES: { ext: string; name: string; short: string }[] = [
  { ext: "body-gbc", name: "Global Boxing Council", short: "GBC" },
  { ext: "body-ira", name: "International Ring Association", short: "IRA" },
  { ext: "body-wpa", name: "World Pugilistic Alliance", short: "WPA" },
  { ext: "body-pcbu", name: "Pan-Continental Boxing Union", short: "PCBU" },
];
export const BROADCASTERS = ["RingPass (streaming)", "PrimeBout PPV", "FightNet Free", "Arena Sports TV", "KO Channel"];
export const VENUE_CAP: Record<string, number> = {
  "T-Mobile Arena": 20000, "Madison Square Garden": 19500, "Kingdom Arena": 17000, "O2 Arena": 20000, "Co-op Live": 23500, "Ryogoku Kokugikan": 11000,
  "Arena CDMX": 22300, "Arena Borregos": 6500, "American Airlines Center": 19200, "Uber Arena": 17000, "Mall of Asia Arena": 15000,
  "Palace of Sports": 10000, "Luna Park": 8500, "Teslim Balogun Stadium": 24000,
};

/** First names for the women's roster (surnames are shared with the men's pools). */
export const FIRST_F: Record<string, string[]> = {
  "United States": ["Alicia", "Tamara", "Jada", "Keira", "Monique", "Brianna", "Sloane", "Imani"],
  Mexico: ["Valeria", "Camila", "Ximena", "Daniela", "Renata", "Paola", "Marisol", "Itzel"],
  "United Kingdom": ["Poppy", "Imogen", "Megan", "Freya", "Ellie", "Niamh", "Bethan", "Orla"],
  Japan: ["Haruka", "Mio", "Sakura", "Aoi", "Yui", "Noa", "Rin", "Akari"],
  Ukraine: ["Oksana", "Daryna", "Iryna", "Kateryna", "Yulia", "Solomiya", "Anastasiia", "Mariia"],
  Philippines: ["Lourdes", "Maricel", "Joanna", "Rhea", "Ligaya", "Carmina", "Analyn", "Gemma"],
  Nigeria: ["Adaeze", "Folake", "Ngozi", "Temitope", "Chioma", "Yetunde", "Amaka", "Bisi"],
  Argentina: ["Sofía", "Luciana", "Agustina", "Julieta", "Camila", "Florencia", "Milagros", "Rocío"],
  "Saudi Arabia": ["Noura", "Reem", "Lamar", "Haya", "Dana", "Jawaher", "Sarah", "Maha"],
  Germany: ["Lena", "Hannah", "Greta", "Marlene", "Svenja", "Katharina", "Jana", "Nele"],
};
/** Indices into the 17 divisions where the demo has a women's roster (flyweight through super middleweight). */
export const WOMEN_CLASSES = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
