//! Компайл-тайм обфускация строк.
//!
//! Задача — чтобы «чувствительные» строки (список детектируемых читов, имена
//! инструментов реверса, имена переменных окружения секретного канала) НЕ лежали
//! в бинарнике открытым текстом. Иначе взломщик находит их простым
//! `strings launcher.exe` и обходит проверку переименованием инжектора.
//!
//! Раньше использовался слабый XOR с коротким повторяющимся ключом (13 байт):
//! период ключа виден в дампе, а частотный анализ вскрывает гамму. Теперь ключевой
//! поток генерируется финализатором splitmix64 — на каждую позицию свой
//! псевдослучайный байт без короткого периода, а `enc()` остаётся `const fn`,
//! поэтому в бинарник попадают только зашифрованные байты.
//!
//! Дополнительно доступен макрос [`obf_str!`], который шифрует строковый литерал
//! прямо по месту использования (со своим ключом на каждый call-site, зависящим
//! от `line!()/column!()`), а расшифровывает в рантайме в `String`.

/// Базовый секрет гаммы. Собирается из нескольких частей, чтобы не светиться
/// одной 8-байтовой константой в дампе.
const SEED_A: u64 = 0x50E5_1A7C;
const SEED_B: u64 = 0x9B34_6F21;

#[inline(always)]
const fn base_seed() -> u64 {
    (SEED_A << 32) ^ SEED_B ^ 0xA5A5_5A5A_C3C3_3C3C
}

/// Финализатор splitmix64: даёт хорошее лавинообразное перемешивание, зависит от
/// позиции `i`, поэтому ключевой поток не повторяется на длине строки.
#[inline(always)]
const fn mix(seed: u64, i: usize) -> u8 {
    let mut z = seed.wrapping_add((i as u64).wrapping_add(1).wrapping_mul(0x9E37_79B9_7F4A_7C15));
    z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
    z ^= z >> 31;
    (z & 0xFF) as u8
}

/// Ключ гаммы для позиции `i` с базовым секретом (рантайм-версия).
#[inline(always)]
fn key_byte(seed: u64, i: usize) -> u8 {
    mix(seed, i)
}

/// Уникальный на call-site ключ (используется макросом `obf_str!`). Смешиваем
/// строку и столбец места вызова, чтобы одинаковые литералы в разных местах
/// шифровались разной гаммой.
#[inline(always)]
pub const fn seed(line: u32, col: u32) -> u64 {
    let mixed = ((line as u64) << 21)
        ^ ((col as u64) << 3)
        ^ (line as u64).wrapping_mul((col as u64).wrapping_add(1));
    base_seed() ^ mixed
}

/// XOR-шифрование на этапе компиляции с базовым секретом (для `static`-инициализации).
pub const fn enc<const N: usize>(s: &[u8; N]) -> [u8; N] {
    let seed = base_seed();
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N {
        out[i] = s[i] ^ mix(seed, i);
        i += 1;
    }
    out
}

/// Компайл-тайм шифрование строкового литерала произвольным ключом (для `obf_str!`).
pub const fn obfuscate<const N: usize>(s: &str, seed: u64) -> [u8; N] {
    let b = s.as_bytes();
    let mut out = [0u8; N];
    let mut i = 0;
    while i < N {
        out[i] = b[i] ^ mix(seed, i);
        i += 1;
    }
    out
}

/// Расшифровывает байты в строку С СОХРАНЕНИЕМ РЕГИСТРА (имена ENV/API/путей).
pub fn dec(bytes: &[u8], seed: u64) -> String {
    let decoded: Vec<u8> = bytes.iter().enumerate().map(|(i, b)| b ^ key_byte(seed, i)).collect();
    String::from_utf8_lossy(&decoded).into_owned()
}

/// Расшифровывает набор обфусцированных срезов в строки нижнего регистра
/// (для сравнения имён процессов без учёта регистра). Использует базовый секрет.
pub fn dec_all(list: &[&[u8]]) -> Vec<String> {
    let seed = base_seed();
    list.iter()
        .map(|bytes| {
            let decoded: Vec<u8> =
                bytes.iter().enumerate().map(|(i, b)| b ^ key_byte(seed, i)).collect();
            String::from_utf8_lossy(&decoded).to_lowercase()
        })
        .collect()
}

/// Шифрует строковый литерал по месту использования и возвращает `String`
/// с исходным регистром. В бинарнике литерал не виден открытым текстом.
///
/// ```ignore
/// let name = obf_str!("PE_AC_PIPE");
/// ```
#[macro_export]
macro_rules! obf_str {
    ($lit:literal) => {{
        const N: usize = $lit.len();
        const SEED: u64 = $crate::obf::seed(line!(), column!());
        const ENC: [u8; N] = $crate::obf::obfuscate::<N>($lit, SEED);
        $crate::obf::dec(&ENC, SEED)
    }};
}

/// Control-flow обфускация блока кода.
///
/// С включённой фичей `cfobf` блок пропускается через `goldberg::goldberg_stmts!`
/// — статементы превращаются в плоский конечный автомат с непрозрачными
/// предикатами (см. `Cargo.toml`). Применяется к самым чувствительным функциям
/// защиты, чтобы их логику было тяжело восстановить в декомпиляторе.
///
/// Без фичи `cfobf` макрос — прозрачная обёртка: код компилируется как есть.
/// Это аварийный «выключатель» на случай проблем со сборкой goldberg.
///
/// ```ignore
/// pub fn check() -> Result<(), String> {
///     obf_flow! {{
///         if bad() { return Err("no".into()); }
///         Ok(())
///     }}
/// }
/// ```
#[cfg(feature = "cfobf")]
#[macro_export]
macro_rules! obf_flow {
    ($($body:tt)*) => {
        ::goldberg::goldberg_stmts! { $($body)* }
    };
}

#[cfg(not(feature = "cfobf"))]
#[macro_export]
macro_rules! obf_flow {
    ($($body:tt)*) => {
        $($body)*
    };
}
