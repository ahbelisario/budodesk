/**
 * Plantillas de grados precargadas. Un dojo puede crear una disciplina a partir de una
 * plantilla y después ajustar todo (nombres, colores, tiempos, edades).
 *
 * Reglas del catálogo:
 *  - Solo se capturan tiempos y edades que vienen de un reglamento publicado (campo `source`).
 *  - Lo que varía por país, federación o escuela queda en null y se explica en `notes`
 *    con ⚠️ para que el dojo lo complete con las reglas de SU federación.
 *  - min_months = tiempo mínimo en el grado ANTERIOR (igual que en la tabla ranks).
 *  - min_classes = asistencias mínimas en el grado anterior (Aikikai cuenta "días de práctica").
 *  - Cada alumno tiene un solo grado actual por disciplina, por eso kyu y dan van en la misma
 *    ruta (el paso de 1er kyu a 1er dan es "el siguiente grado"). Los títulos (renshi, kyoshi,
 *    hanshi) no son grados en esta secuencia; se mencionan en las notas.
 */

const C = {
  white: '#FFFFFF', yellow: '#F4C430', orange: '#F28C28', green: '#2E8B57', blue: '#1F5FBF',
  purple: '#6A3D9A', brown: '#7B4A2A', black: '#111111', red: '#C62828', grey: '#9E9E9E',
  silver: '#B8BCC2', gold: '#C9A227', navy: '#23395B',
};

const ORD = ['', '1er', '2º', '3er', '4º', '5º', '6º', '7º', '8º', '9º', '10º', '11º', '12º', '13º', '14º', '15º'];

/** kyu descendentes: from (p. ej. 6) → 1 */
function kyus(from, opts = {}) {
  const out = [];
  for (let n = from; n >= 1; n -= 1) {
    out.push({
      name: `${ORD[n]} Kyu`, short_name: `${n}K`, kind: 'kyu',
      color: opts.colors ? opts.colors[from - n] : C.white,
      min_months: opts.months ? opts.months[from - n] ?? null : null,
      min_classes: opts.classes ? opts.classes[from - n] ?? null : null,
    });
  }
  return out;
}

/** dans 1..n; spec[i] = { months, age, color } para el dan i+1 */
function dans(n, spec = [], label = 'Dan') {
  return Array.from({ length: n }, (_, i) => ({
    name: `${ORD[i + 1]} ${label}`, short_name: `${i + 1}D`, kind: 'dan',
    color: spec[i]?.color ?? C.black,
    min_months: spec[i]?.months ?? null, min_age: spec[i]?.age ?? null, min_classes: spec[i]?.classes ?? null,
  }));
}

// FIK — Standard Guideline for Dan/Kyu Examination (kendo; iaido y jodo usan los mismos tiempos de dan)
const FIK_DANS = [
  { age: 13 }, { months: 12 }, { months: 24 }, { months: 36 }, { months: 48 },
  { months: 60 }, { months: 72 }, { months: 120, age: 46 },
];

const TEMPLATES = [
  {
    key: 'kendo-fik', name: 'Kendo', style: 'FIK / ZNKR', org: 'Federación Internacional de Kendo (FIK)',
    source: 'FIK Standard Guideline for Dan/Kyu Examination (revisión 2020)',
    notes: [
      'Tiempos entre dan y edades (1er dan desde 13 años, 8º dan a los 46+) tomados de la guía FIK.',
      '⚠️ Los tiempos entre kyu y el tiempo de 1er kyu a 1er dan los fija cada federación; quedan vacíos.',
      'La FIK permite reducir tiempos de 6º a 8º dan a partir de los 60 años; ajústalo a mano si aplica.',
      'Títulos (shogo): Renshi, Kyoshi y Hanshi se otorgan aparte; no forman parte de esta secuencia.',
    ],
    tracks: [{ name: 'Kyu y Dan', display_style: 'rank', ranks: [...kyus(6), ...dans(8, FIK_DANS)] }],
  },
  {
    key: 'iaido-fik', name: 'Iaido', style: 'ZNKR Seitei', org: 'Federación Internacional de Kendo (FIK)',
    source: 'FIK Standard Guideline for Dan/Kyu Examination (misma tabla de dan que kendo)',
    notes: [
      'La FIK aplica a iaido los mismos tiempos de dan que a kendo (1er dan desde 13 años).',
      '⚠️ Tiempos entre kyu: los define tu federación nacional.',
      'Títulos (shogo): Renshi, Kyoshi y Hanshi se otorgan aparte.',
    ],
    tracks: [{ name: 'Kyu y Dan', display_style: 'rank', ranks: [...kyus(5), ...dans(8, FIK_DANS)] }],
  },
  {
    key: 'judo', name: 'Judo', style: 'Kodokan', org: 'Kodokan / federación nacional',
    source: 'USA Judo y British Judo (edad mínima de 15 años para shodan); colores de dan de British Judo',
    notes: [
      '1er dan desde 15 años (USA Judo y British Judo coinciden).',
      '⚠️ El Kodokan no publica tiempos fijos entre dan: dependen de resultados de competencia y de cada federación. Quedan vacíos.',
      '⚠️ Los colores de kyu cambian por país; aquí van los más comunes (blanco, amarillo, naranja, verde, azul, café).',
      '6º a 8º dan: cinta roja y blanca; 9º y 10º: roja.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'belt', ranks: [
        ...kyus(6, { colors: [C.white, C.yellow, C.orange, C.green, C.blue, C.brown] }),
        ...dans(10, [{ age: 15 }, {}, {}, {}, {}, { color: C.red }, { color: C.red }, { color: C.red }, { color: C.red }, { color: C.red }])
          .map((r, i) => (i >= 5 && i <= 7 ? { ...r, stripe_color: C.white } : r)),
      ],
    }],
  },
  {
    key: 'bjj-ibjjf', name: 'Jiu-jitsu brasileño', style: 'IBJJF', org: 'International Brazilian Jiu-Jitsu Federation',
    source: 'IBJJF Graduation System (edades y tiempos mínimos por cinta)',
    notes: [
      'Adultos: azul desde 16 años; morada 16+ tras 2 años de azul; café 18+ tras 1.5 años de morada; negra 19+ tras 1 año de café.',
      'Infantil (4 a 15 años): edades mínimas por cinta según IBJJF; sin tiempo mínimo publicado.',
      '⚠️ Tiempos entre grados de cinta negra y edades de coral: no verificados; quedan vacíos.',
      '⚠️ El número de grados (tips) por cinta infantil puede variar por academia; aquí van 4.',
    ],
    tracks: [
      {
        name: 'Adultos', min_age: 16, display_style: 'belt', ranks: [
          { name: 'Blanca', kind: 'belt', color: C.white, max_stripes: 4 },
          { name: 'Azul', kind: 'belt', color: C.blue, max_stripes: 4, min_age: 16 },
          { name: 'Morada', kind: 'belt', color: C.purple, max_stripes: 4, min_age: 16, min_months: 24 },
          { name: 'Café', kind: 'belt', color: C.brown, max_stripes: 4, min_age: 18, min_months: 18 },
          { name: 'Negra', kind: 'belt', color: C.black, max_stripes: 6, min_age: 19, min_months: 12 },
          { name: 'Coral roja y negra (7º grado)', kind: 'belt', color: C.red, stripe_color: C.black },
          { name: 'Coral roja y blanca (8º grado)', kind: 'belt', color: C.red, stripe_color: C.white },
          { name: 'Roja (9º grado)', kind: 'belt', color: C.red },
        ],
      },
      {
        name: 'Infantil', min_age: 4, max_age: 15, display_style: 'belt', ranks: [
          { name: 'Blanca', kind: 'belt', color: C.white, max_stripes: 4 },
          ...[[C.grey, 4], [C.yellow, 7], [C.orange, 10], [C.green, 13]].flatMap(([col, age], g) => {
            const n = ['Gris', 'Amarilla', 'Naranja', 'Verde'][g];
            return [
              { name: `${n} y blanca`, kind: 'belt', color: col, stripe_color: C.white, max_stripes: 4, min_age: age },
              { name: n, kind: 'belt', color: col, max_stripes: 4, min_age: age + 1 },
              { name: `${n} y negra`, kind: 'belt', color: col, stripe_color: C.black, max_stripes: 4, min_age: age + 2 },
            ];
          }),
        ],
      },
    ],
  },
  {
    key: 'taekwondo-kukkiwon', name: 'Taekwondo', style: 'Kukkiwon', org: 'Kukkiwon (World Taekwondo)',
    source: 'Reglamento de promoción Kukkiwon (tiempos y edades de dan y poom)',
    notes: [
      '1er dan desde 15 años, 6 meses después del 1er gup. Menores de 15 reciben poom.',
      'Dan: 2º 1 año (16+), 3º 2 años (18+), 4º 3 años (21+), 5º 4 años (25+), 6º 5 años (30+), 7º 6 años (36+).',
      '⚠️ 4º y 5º dan desde poom tienen edades menores (18 y 22); ajústalo a mano en esos casos.',
      '⚠️ 8º y 9º dan: no verificados; quedan vacíos.',
      '⚠️ Los colores de gup cambian por escuela; aquí van los más comunes.',
    ],
    tracks: [
      {
        name: 'Gup y Dan', display_style: 'rank', ranks: [
          ...[[10, C.white], [9, C.yellow], [8, C.yellow], [7, C.green], [6, C.green], [5, C.blue], [4, C.blue], [3, C.red], [2, C.red], [1, C.red]]
            .map(([n, col]) => ({ name: `${ORD[n]} Gup`, short_name: `${n}G`, kind: 'kyu', color: col })),
          ...dans(9, [{ months: 6, age: 15 }, { months: 12, age: 16 }, { months: 24, age: 18 }, { months: 36, age: 21 },
            { months: 48, age: 25 }, { months: 60, age: 30 }, { months: 72, age: 36 }, {}, {}]),
        ],
      },
      {
        name: 'Poom (menores de 15)', max_age: 14, display_style: 'rank', ranks: [
          { name: '1er Poom', short_name: '1P', kind: 'dan', color: C.red, stripe_color: C.black, min_months: 6 },
          { name: '2º Poom', short_name: '2P', kind: 'dan', color: C.red, stripe_color: C.black, min_months: 12 },
          { name: '3er Poom', short_name: '3P', kind: 'dan', color: C.red, stripe_color: C.black, min_months: 24 },
          { name: '4º Poom', short_name: '4P', kind: 'dan', color: C.red, stripe_color: C.black, min_months: 36 },
        ],
      },
    ],
  },
  {
    key: 'aikido-aikikai', name: 'Aikido', style: 'Aikikai', org: 'Aikikai Foundation (Hombu Dojo)',
    source: 'Aikikai Hombu Dojo — Examination Guidelines',
    notes: [
      'Aikikai cuenta días de práctica; aquí van como "clases mínimas". 1er dan: 70 días tras 1er kyu, 15+ años.',
      '2º dan: 1 año y 200 días; 3er dan: 2 años y 300 días; 4º dan: 3 años, 400 días y 22+ años.',
      '5º dan en adelante se otorgan por recomendación, sin examen.',
      '⚠️ Días de práctica para 1er kyu: no verificado; queda vacío.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'rank', ranks: [
        ...kyus(5, { classes: [30, 40, 50, 50, null] }),
        ...dans(4, [{ classes: 70, age: 15 }, { months: 12, classes: 200 }, { months: 24, classes: 300 }, { months: 36, classes: 400, age: 22 }]),
        ...dans(8).slice(4).map((r) => ({ ...r, requires_exam: false })),
      ],
    }],
  },
  {
    key: 'aikido-tendoryu', name: 'Aikido', style: 'Tendoryu', org: 'Seikoukan (configuración del dojo)',
    source: 'Estructura de grados que usa Seikoukan para Aikido Tendoryu',
    notes: [
      '10 kyu y 5 dan, con los tiempos y clases mínimas que usa Seikoukan de 6º kyu a 1er dan.',
      '⚠️ Del 10º al 7º kyu y del 2º dan en adelante no hay tiempos capturados; ajústalos a tu dojo.',
    ],
    tracks: [{
      name: 'General', display_style: 'rank', ranks: [
        ...[10, 9, 8, 7].map((n) => ({ name: `${['', '1er', '2do', '3er', '4to', '5to', '6to', '7mo', '8vo', '9no', '10mo'][n]} Kyu`, kind: 'kyu', color: C.white })),
        { name: '6to Kyu', kind: 'kyu', color: C.white, min_months: 3, min_classes: 30 },
        { name: '5to Kyu', kind: 'kyu', color: C.white, min_months: 3, min_classes: 30 },
        { name: '4to Kyu', kind: 'kyu', color: C.white, min_months: 7, min_classes: 40 },
        { name: '3er Kyu', kind: 'kyu', color: C.white, min_months: 4, min_classes: 40 },
        { name: '2do Kyu', kind: 'kyu', color: C.white, min_months: 6, min_classes: 50 },
        { name: '1er Kyu', kind: 'kyu', color: C.white, min_months: 6, min_classes: 50 },
        { name: '1er Dan', kind: 'dan', color: '#000000', min_months: 12, min_classes: 100 },
        ...['2do', '3er', '4to', '5to'].map((o) => ({ name: `${o} Dan`, kind: 'dan', color: '#000000' })),
      ],
    }],
  },
  {
    key: 'karate-jka', name: 'Karate', style: 'Shotokan (JKA)', org: 'Japan Karate Association (JKA)',
    source: 'JKA — DAN Ranking (jka.or.jp)',
    notes: [
      'Tiempos entre dan de la JKA: 1er dan 1 año tras 1er kyu; 2º 1 año; 3º 2 años (18+); 4º 3; 5º 4; 6º 6; 7º 7 (50+); 8º 7 (60+); 9º 8; 10º 9.',
      '8º a 10º dan se otorgan por recomendación, sin examen.',
      '⚠️ La JKA no publica tiempos entre kyu, edad mínima de 1er dan ni colores de cinturón; aquí van los colores más comunes, ajústalos a tu dojo.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'belt', ranks: [
        ...kyus(10, { colors: [C.white, C.yellow, C.orange, C.green, C.blue, C.purple, C.brown, C.brown, C.brown, C.brown] }),
        ...dans(10, [{ months: 12 }, { months: 12 }, { months: 24, age: 18 }, { months: 36 }, { months: 48 },
          { months: 72 }, { months: 84, age: 50 }, { months: 84, age: 60 }, { months: 96 }, { months: 108 }])
          .map((r, i) => (i >= 7 ? { ...r, requires_exam: false } : r)),
      ],
    }],
  },
  {
    key: 'karate-wkf', name: 'Karate', style: 'Federación (criterio WKF)', org: 'USA Karate (miembro de la WKF)',
    source: 'USA Karate — Dan Certification Policies, Procedures and Requirements 2026',
    notes: [
      'Sirve para Goju-ryu, Shito-ryu, Wado-ryu y otros estilos que gradúan por federación nacional.',
      'Edades y tiempos de USA Karate: 1er dan 16+; 2º 2 años y 18+; 3º 3 años y 21+; 4º 4 años y 25+; 5º 5 años y 30+.',
      '⚠️ Son reglas de la federación de EE. UU.; la de tu país puede variar. 6º dan en adelante y tiempos entre kyu: no verificados.',
      '⚠️ Colores de kyu: los más comunes; cambian por estilo y escuela.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'belt', ranks: [
        ...kyus(10, { colors: [C.white, C.yellow, C.orange, C.green, C.blue, C.purple, C.brown, C.brown, C.brown, C.brown] }),
        ...dans(10, [{ age: 16 }, { months: 24, age: 18 }, { months: 36, age: 21 }, { months: 48, age: 25 }, { months: 60, age: 30 }]),
      ],
    }],
  },
  {
    key: 'hapkido', name: 'Hapkido', style: null, org: 'International Hapkido Federation (IHF)',
    source: 'IHF — Time In Rank Requirements (itatkd.com)',
    notes: [
      'Tiempos mínimos de la IHF, pensados para alumnos que entrenan 3 días por semana, 1.5 horas por clase.',
      'Gup: 2 meses de 10º a 6º gup, 3 meses en 5º, 6 meses en 4º, 3º y 2º, 9 meses en 1er gup. Dan: 2, 2, 4, 4, 6, 6 y 8 años.',
      '⚠️ No hay una federación única de hapkido; otras asociaciones (p. ej. Korea Hapkido Federation) tienen sus propios tiempos. La IHF no publica edades mínimas.',
    ],
    tracks: [{
      name: 'Gup y Dan', display_style: 'belt', ranks: [
        ...[[10, C.white, null], [9, C.white, C.yellow], [8, C.yellow, null], [7, C.yellow, C.green], [6, C.green, null],
          [5, C.green, C.blue], [4, C.blue, null], [3, C.blue, C.red], [2, C.red, null], [1, C.red, C.black]]
          .map(([n, col, st], i) => ({ name: `${ORD[n]} Gup`, short_name: `${n}G`, kind: 'kyu', color: col, stripe_color: st,
            min_months: [null, 2, 2, 2, 2, 2, 3, 6, 6, 6][i] })),
        ...dans(9, [{ months: 9 }, { months: 24 }, { months: 24 }, { months: 48 }, { months: 48 }, { months: 72 }, { months: 72 }, { months: 96 }]),
      ],
    }],
  },
  {
    key: 'kickboxing-wako', name: 'Kickboxing', style: 'WAKO', org: 'World Association of Kickboxing Organizations (WAKO)',
    source: 'WAKO Grading Syllabus — International Black Belt Dan certificate (vigente desde 2025)',
    notes: [
      'Cinta negra 1er dan: el año en que el alumno cumple 16. Tiempos entre dan: 2, 3, 4, 5, 6 y 7 años (de 1º a 7º).',
      '8º a 10º dan: los otorga el Consejo de WAKO con un mínimo de 35 años de dedicación al kickboxing.',
      '⚠️ El documento de WAKO no cubre los kyu: los colores y tiempos de cintas de color los define cada federación nacional. Aquí van los más comunes.',
    ],
    tracks: [{
      name: 'Cintas y Dan', display_style: 'belt', ranks: [
        ...['Blanca', 'Amarilla', 'Naranja', 'Verde', 'Azul', 'Café'].map((n, i) => ({ name: n, kind: 'belt',
          color: [C.white, C.yellow, C.orange, C.green, C.blue, C.brown][i] })),
        ...dans(10, [{ age: 16 }, { months: 24 }, { months: 36 }, { months: 48 }, { months: 60 }, { months: 72 }, { months: 84 }])
          .map((r, i) => (i >= 7 ? { ...r, requires_exam: false } : r)),
      ],
    }],
  },
  {
    key: 'krav-maga-kmg', name: 'Krav Maga', style: 'Niveles P, G y E', org: 'Krav Maga Global (KMG) y otras',
    source: 'Estructura civil de KMG: Practitioner 1-5, Graduate 1-5, Expert 1-5, Master 1-3',
    notes: [
      '18 niveles: Practitioner (P1-P5), Graduate (G1-G5), Expert (E1-E5) y Master (M1-M3).',
      '⚠️ No encontré los tiempos mínimos oficiales de KMG; quedan vacíos. Como referencia, una fuente de IKMF menciona un mínimo de 3 meses para P1.',
      'Krav Maga Worldwide usa otro sistema (5 niveles con cintas de color); si es tu caso, ajusta los nombres.',
    ],
    tracks: [{
      name: 'Niveles', display_style: 'rank', ranks: [
        ...[1, 2, 3, 4, 5].map((n) => ({ name: `Practitioner ${n}`, short_name: `P${n}`, kind: 'other', color: C.yellow })),
        ...[1, 2, 3, 4, 5].map((n) => ({ name: `Graduate ${n}`, short_name: `G${n}`, kind: 'other', color: C.blue })),
        ...[1, 2, 3, 4, 5].map((n) => ({ name: `Expert ${n}`, short_name: `E${n}`, kind: 'other', color: C.black })),
        ...[1, 2, 3].map((n) => ({ name: `Master ${n}`, short_name: `M${n}`, kind: 'other', color: C.red, requires_exam: false })),
      ],
    }],
  },
  {
    key: 'capoeira', name: 'Capoeira', style: 'Cordões (bandera de Brasil)', org: 'Federação Paulista de Capoeira (1974)',
    source: 'Escala de graduación basada en los colores de la bandera de Brasil, establecida en 1974 (Revista Ponto Urbe, USP)',
    notes: [
      'Diez cordões con al menos un año en cada etapa: verde; verde y amarillo; amarillo; amarillo y azul; azul; verde, amarillo y azul; blanco y verde; blanco y amarillo; blanco y azul; blanco.',
      '⚠️ Cada grupo (Abadá, Senzala, Capoeira Brasil…) tiene su propia secuencia de cordas, y muchos grupos de Angola no usan cordas. Ajusta colores y nombres a tu grupo.',
    ],
    tracks: [{
      name: 'Cordões', display_style: 'belt', ranks: [
        { name: 'Verde', color: C.green }, { name: 'Verde y amarillo', color: C.green, stripe_color: C.yellow },
        { name: 'Amarillo', color: C.yellow }, { name: 'Amarillo y azul', color: C.yellow, stripe_color: C.blue },
        { name: 'Azul', color: C.blue }, { name: 'Verde, amarillo y azul', color: C.green, stripe_color: C.blue },
        { name: 'Blanco y verde', color: C.white, stripe_color: C.green }, { name: 'Blanco y amarillo', color: C.white, stripe_color: C.yellow },
        { name: 'Blanco y azul', color: C.white, stripe_color: C.blue }, { name: 'Blanco', color: C.white },
      ].map((r, i) => ({ ...r, kind: 'belt', min_months: i ? 12 : null })),
    }],
  },
  {
    key: 'muay-thai-kma', name: 'Muay Thai', style: 'Khan (KMA)', org: 'Kru Muaythai Association (KMA)',
    source: 'Sistema Khan de la Kru Muaythai Association (Tailandia, 2003); colores de mongkol según fuente secundaria',
    notes: [
      'El Muay Thai tradicional no usa grados; la KMA creó el sistema Khan (1 a 10) para alumnos, con mongkol de color en lugar de cinturón.',
      '⚠️ Los colores vienen de una fuente secundaria (solo el rojo de Khan 10 está confirmado en el sitio de la KMA). Sin tiempos mínimos publicados.',
      'El prajied (brazalete) tradicional no indica grado; si tu gimnasio lo usa como grado, cambia los nombres.',
    ],
    tracks: [{
      name: 'Khan', display_style: 'belt', ranks: [
        [C.white, null], [C.yellow, null], [C.yellow, C.white], [C.green, null], [C.green, C.white],
        [C.blue, null], [C.blue, C.white], [C.brown, null], [C.brown, C.white], [C.red, null],
      ].map(([col, st], i) => ({ name: `Khan ${i + 1}`, short_name: `K${i + 1}`, kind: 'other', color: col, stripe_color: st })),
    }],
  },
  {
    key: 'ninjutsu-bujinkan', name: 'Ninjutsu', style: 'Bujinkan', org: 'Bujinkan Dojo (Hombu, Noda)',
    source: 'Estructura de grados de la Bujinkan: mukyu, 9 kyu y 15 dan',
    notes: [
      'Mukyu (sin grado) y 9º a 1er kyu; 15 dan. 5º dan requiere la prueba del sakki ante el soke o un representante autorizado.',
      '⚠️ El color del cinturón no indica el kyu: normalmente solo hay dos colores y el grado se ve en el wappen (parche). Aquí todos los kyu van en verde.',
      '⚠️ Sin tiempos mínimos publicados.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'rank', ranks: [
        { name: 'Mukyu', short_name: '0K', kind: 'kyu', color: C.white },
        ...kyus(9, { colors: Array(9).fill(C.green) }),
        ...dans(15),
      ],
    }],
  },
  {
    key: 'kenpo-parker', name: 'Kenpo', style: 'American Kenpo (Ed Parker)', org: 'International Kenpo Karate Association (IKKA) y derivadas',
    source: 'Orden de cinturones de American Kenpo (Ed Parker)',
    notes: [
      'Blanco, amarillo, naranja, morado, azul, verde, café de 3er a 1er grado y negro de 1º a 10º grado.',
      '⚠️ Cada asociación de kenpo fija sus tiempos y edades; quedan vacíos.',
    ],
    tracks: [{
      name: 'Cintas y Grados', display_style: 'belt', ranks: [
        ...[['Blanca', C.white], ['Amarilla', C.yellow], ['Naranja', C.orange], ['Morada', C.purple], ['Azul', C.blue], ['Verde', C.green]]
          .map(([n, col]) => ({ name: n, kind: 'belt', color: col })),
        ...['3er', '2º', '1er'].map((o) => ({ name: `Café ${o} grado`, kind: 'kyu', color: C.brown })),
        ...dans(10).map((r, i) => ({ ...r, name: `Negra ${ORD[i + 1]} grado` })),
      ],
    }],
  },
  {
    key: 'kyudo-ankf', name: 'Kyudo', style: 'ANKF', org: 'All Nippon Kyudo Federation',
    source: 'Estructura de dan y títulos de la ANKF',
    notes: [
      '⚠️ No encontré los tiempos y edades oficiales de la ANKF; todos quedan vacíos para que los captures.',
      'Títulos: Renshi, Kyoshi y Hanshi (Hanshi solo por recomendación); se otorgan aparte.',
    ],
    tracks: [{ name: 'Kyu y Dan', display_style: 'rank', ranks: [...kyus(5), ...dans(10)] }],
  },
  {
    key: 'naginata', name: 'Naginata', style: 'Atarashii Naginata', org: 'All Japan Naginata Federation (AJNF)',
    source: 'US Naginata Federation — Kyu Shinsa Guidelines y Ranking Regulations',
    notes: [
      'Shodan desde 13 años (USNF).',
      '⚠️ Los tiempos entre kyu vienen de la guía de la federación de EE. UU. (3er kyu: 3 meses tras 4º; 2º kyu: 4 meses tras 3º); confirma con tu federación.',
      '⚠️ Tiempos entre dan: no verificados.',
      'Títulos: Renshi, Kyoshi (vía federación) y Hanshi (lo otorga la AJNF).',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'rank', ranks: [
        ...kyus(5, { months: [null, null, 3, 4, null] }),
        ...dans(8, [{ age: 13 }]),
      ],
    }],
  },
  {
    key: 'jujutsu', name: 'Jujutsu japonés', style: null, org: 'Sin organismo único',
    source: 'Plantilla genérica: no existe un reglamento internacional único',
    notes: [
      '⚠️ Cada escuela (ryu) y federación tiene su propio sistema. Esta plantilla solo da la forma común (6 kyu y 10 dan) con los colores más usados.',
      '⚠️ Tiempos y edades vacíos: captura los de tu escuela.',
    ],
    tracks: [{
      name: 'Kyu y Dan', display_style: 'belt', ranks: [
        ...kyus(6, { colors: [C.white, C.yellow, C.orange, C.green, C.blue, C.brown] }),
        ...dans(10),
      ],
    }],
  },
  {
    key: 'wushu-duanwei', name: 'Kung fu (Wushu)', style: 'Duanwei', org: 'Chinese Wushu Association',
    source: 'Chinese Wushu Duanwei System; convocatoria CWA de examen en el extranjero 2025 (tiempos de 3º a 6º duan)',
    notes: [
      '9 duan en tres niveles: básico (águila), intermedio (tigre) y avanzado (dragón); azul, plata y oro.',
      'Tiempos: 3er duan 1 año en 2º; 4º, 5º y 6º duan 2 años en el anterior (convocatoria CWA).',
      '⚠️ 2º duan (1 año) viene de una fuente académica, no del reglamento; 7º a 9º duan: no verificados.',
      'Existen 3 niveles previos (pre-duan) que no se incluyen; agrégalos si los usas.',
    ],
    tracks: [{ name: 'Duan', display_style: 'rank', ranks: duanwei() }],
  },
  {
    key: 'taichi-duanwei', name: 'Tai chi', style: 'Duanwei', org: 'Chinese Wushu Association',
    source: 'Chinese Wushu Duanwei System (incluye tai chi entre sus estilos reconocidos)',
    notes: [
      'El Duanwei reconoce el tai chi, con los mismos 9 duan que el wushu.',
      '⚠️ Muchas escuelas de tai chi no usan grados o usan los de su familia (Yang, Chen…); ajusta o borra lo que no aplique.',
      '⚠️ Mismos tiempos y advertencias que la plantilla de Kung fu.',
    ],
    tracks: [{ name: 'Duan', display_style: 'rank', ranks: duanwei() }],
  },
  {
    key: 'wingchun', name: 'Wing Chun', style: 'Ip Man', org: 'Sin organismo único',
    source: 'Plantilla por formas del sistema; el linaje de Ip Man tradicionalmente no usa grados',
    notes: [
      '⚠️ No hay un sistema oficial de grados en Wing Chun; en la línea de Ip Man tradicionalmente no se usan cintas ni fajas.',
      'Esta plantilla propone un nivel por cada forma del sistema; es una sugerencia, no un estándar.',
    ],
    tracks: [{
      name: 'Formas', display_style: 'rank', ranks: [
        'Siu Nim Tau', 'Chum Kiu', 'Biu Jee', 'Muk Yan Jong', 'Luk Dim Boon Kwan', 'Baat Jaam Dao',
      ].map((n) => ({ name: n, kind: 'other', color: C.navy })),
    }],
  },
];

function duanwei() {
  const names = ['Águila azul', 'Águila plateada', 'Águila dorada', 'Tigre azul', 'Tigre plateado', 'Tigre dorado', 'Dragón azul', 'Dragón plateado', 'Dragón dorado'];
  const cols = [C.blue, C.silver, C.gold];
  const months = [null, 12, 12, 24, 24, 24, null, null, null];
  return names.map((n, i) => ({
    name: `${ORD[i + 1]} Duan · ${n}`, short_name: `${i + 1}D`, kind: 'dan', color: cols[i % 3], min_months: months[i],
  }));
}

// Normaliza cada grado con los valores por defecto de la tabla
const DEFAULTS = { short_name: null, kind: 'belt', color: C.white, stripe_color: null, max_stripes: 0, min_months: null, min_classes: null, min_age: null, requires_exam: true };
for (const tpl of TEMPLATES) {
  for (const tr of tpl.tracks) tr.ranks = tr.ranks.map((r) => ({ ...DEFAULTS, ...r }));
}

function listTemplates() {
  return TEMPLATES.map(({ tracks, ...t }) => ({
    ...t,
    tracks: tracks.map((tr) => ({ name: tr.name, min_age: tr.min_age ?? null, max_age: tr.max_age ?? null, display_style: tr.display_style, ranks: tr.ranks })),
  }));
}

function getTemplate(key) {
  return TEMPLATES.find((t) => t.key === key) || null;
}

module.exports = { listTemplates, getTemplate, BUILTIN_KEYS: TEMPLATES.map((t) => t.key) };
