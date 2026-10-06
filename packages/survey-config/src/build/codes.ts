/**
 * Карта стабильных кодов для контента прототипа.
 *
 * Ключи верхнего уровня — ключи веток прототипа (L2: 'ж_face' …).
 * Для каждого вопроса (по порядку в прототипе) — семантический key
 * и коды вариантов (по порядку в прототипе). Генератор проверяет,
 * что число кодов совпадает с числом вариантов, иначе падает.
 *
 * Коды неизменны между версиями конфига (ТЗ 6.1): удаление варианта —
 * только через deprecated, переименование кода запрещено.
 */

export type QuestionCodes = {
  key: string;
  codes: string[];
  /** Явные теги для профиля по индексам вариантов (ТЗ 6.3.4). */
  tags?: Record<number, string[]>;
  /** Явная пометка exclusive (дополняет автодетект по тексту). */
  exclusive?: number[];
};

export type BranchCodes = {
  /** id ветки в конфиге; у общих веток — 'shared_*'. */
  id: string;
  questions: QuestionCodes[];
};

export const BASE_CODES = {
  gender: ["female", "male"],
  psycho: ["E", "P", "L", "M"],
  category: ["face", "body", "hair", "sun", "makeup", "perfume", "home"],
} as const;

export const WIDGET_CODES: Record<number, string> = {
  1: "favorites",
  2: "preferences_quiz",
  3: "loyalty_program",
  4: "ai_assistant",
  5: "news_blog",
  6: "beauty_services",
  7: "wishlist",
  8: "recommendations_feed",
  9: "community",
  10: "gamification",
  11: "beauty_calendar",
  12: "notifications",
  13: "product_subscription",
  14: "closed_sales",
  15: "expert_selections",
  16: "beauty_boxes",
  17: "order_info",
};

export const BRANCH_CODES: Record<string, BranchCodes> = {
  ж_face: {
    id: "female_face",
    questions: [
      {
        key: "face_skin_type",
        codes: ["oily", "combination", "dry", "normal"],
        tags: {
          0: ["skin_type:oily"],
          1: ["skin_type:combination"],
          2: ["skin_type:dry"],
          3: ["skin_type:normal"],
        },
      },
      {
        key: "face_concerns",
        codes: ["dehydrated", "problem", "dull", "aging", "none"],
        tags: {
          0: ["skin_state:dehydrated"],
          1: ["skin_state:problem"],
          2: ["skin_state:dull"],
          3: ["skin_state:aging"],
        },
      },
      {
        key: "face_routine",
        codes: [
          "cleanser",
          "toner",
          "serum",
          "cream_universal",
          "cream_day",
          "cream_night",
          "eye_cream",
          "neck_cream",
          "scrub_peeling",
          "mask_cleansing",
          "mask_care",
          "mask_pores",
          "ampoules",
          "spf",
        ],
      },
      { key: "face_cleansing", codes: ["with_water", "without_water"] },
      {
        key: "face_factors",
        codes: [
          "ecology",
          "hard_water",
          "bad_habits",
          "lack_of_sleep",
          "hormonal",
          "sun_exposure",
          "dry_air",
        ],
      },
      { key: "face_texture", codes: ["light", "medium", "rich"] },
      {
        key: "face_gadgets",
        codes: ["massage_roller", "microneedle_roller", "microcurrent", "led_mask", "brush_sponge", "none"],
      },
    ],
  },

  м_face: {
    id: "male_face",
    questions: [
      {
        key: "face_skin_type",
        codes: ["oily", "combination", "normal"],
        tags: { 0: ["skin_type:oily"], 1: ["skin_type:combination"], 2: ["skin_type:normal"] },
      },
      { key: "face_concerns", codes: ["problem", "uneven_tone", "dryness", "aging"] },
      {
        key: "face_routine",
        codes: [
          "cleanser",
          "toner",
          "serum",
          "cream",
          "eye_cream",
          "scrub_peeling",
          "mask_cleansing",
          "mask_moisturizing",
        ],
      },
      {
        key: "face_shaving",
        codes: [
          "shaving_gel",
          "shaving_foam",
          "aftershave_lotion",
          "aftershave_cream",
          "razor",
          "electric_shaver",
          "beard_barber",
          "beard_home_care",
        ],
      },
      {
        key: "face_factors",
        codes: ["ecology", "harsh_work_conditions", "lack_of_sleep", "shaving_irritation"],
      },
    ],
  },

  ж_hair: {
    id: "female_hair",
    questions: [
      { key: "hair_scalp_type", codes: ["oily", "oily_parting", "normal", "dry"] },
      { key: "hair_condition", codes: ["oily_roots_dry_ends", "dry_brittle", "split_ends", "healthy"] },
      {
        key: "hair_concerns",
        codes: [
          "oily_dandruff",
          "dry_dandruff",
          "hair_loss",
          "lack_volume",
          "lack_length",
          "bleached_brittle",
          "color_fades",
          "sensitive_scalp",
          "tangling",
          "none",
        ],
      },
      { key: "hair_wash_frequency", codes: ["daily", "every_other_day", "every_3_days_or_less"] },
      {
        key: "hair_routine",
        codes: [
          "shampoo",
          "conditioner",
          "scalp_mask",
          "hair_mask",
          "scalp_scrub",
          "leave_in",
          "detangling_spray",
          "ends_treatment",
          "dry_shampoo",
        ],
      },
      {
        key: "hair_tools",
        codes: [
          "comb_natural",
          "comb_synthetic",
          "comb_detangling",
          "hair_dryer",
          "straightener_curler",
          "curlers",
        ],
      },
      {
        key: "hair_styling_products",
        codes: [
          "hairspray",
          "mousse",
          "gel",
          "root_powder",
          "wax",
          "volume_spray",
          "shine_spray",
          "heat_protection",
          "none",
        ],
      },
    ],
  },

  м_hair: {
    id: "male_hair",
    questions: [
      { key: "hair_scalp_type", codes: ["very_oily", "oily", "normal", "dry"] },
      { key: "hair_concerns", codes: ["oily_dandruff", "dry_dandruff", "hair_loss", "sensitive_scalp"] },
      { key: "hair_wash_frequency", codes: ["daily", "every_other_day", "every_3_days_or_less"] },
      { key: "hair_routine", codes: ["body_hair_2in1", "shampoo", "conditioner", "hair_mask"] },
      { key: "hair_styling", codes: ["none", "without_heat", "with_heat"] },
      { key: "hair_styling_products", codes: ["gel", "root_powder", "wax", "none"] },
    ],
  },

  ж_body: {
    id: "female_body",
    questions: [
      { key: "body_skin_type", codes: ["dry", "normal", "sensitive", "combination"] },
      {
        key: "body_concerns",
        codes: ["firmness", "cellulite", "stretch_marks", "pigmentation", "dryness", "none"],
      },
      {
        key: "body_corrective_care",
        codes: ["anticellulite", "firming", "stretch_marks", "massage_oils", "none"],
      },
      {
        key: "body_routine",
        codes: ["shower_gel", "scrub", "lotion", "rich_cream", "deodorant", "hand_cream", "foot_cream"],
      },
      { key: "body_tools", codes: ["washcloth_brush", "massage_glove", "roller_massager", "none"] },
      { key: "body_lifestyle", codes: ["sport", "massage_spa", "pool_sauna", "sedentary", "none"] },
    ],
  },

  м_body: {
    id: "male_body",
    questions: [
      { key: "body_skin_type", codes: ["dry", "normal", "sensitive"] },
      {
        key: "body_concerns",
        codes: ["dryness_after_shower", "irritation", "sweating", "rough_skin", "none"],
      },
      {
        key: "body_routine",
        codes: ["shower_gel", "soap", "scrub", "lotion", "deodorant", "hand_cream", "foot_cream"],
      },
      { key: "body_lifestyle", codes: ["sport", "physical_work", "pool_sauna", "sedentary", "none"] },
    ],
  },

  ж_sun: {
    id: "shared_sun",
    questions: [
      { key: "sun_phototype", codes: ["burns_fast", "burns_then_tans", "tans_easily", "never_burns"] },
      {
        key: "sun_features",
        codes: ["pigmentation", "moles", "photosensitive_reaction", "photosensitizing_meds", "none"],
      },
      {
        key: "sun_situations",
        codes: ["daily_city", "beach_vacation", "mountains_ski", "outdoor_sport", "only_very_sunny"],
      },
      {
        key: "sun_routine",
        codes: ["face_spf", "body_spf", "lip_spf", "after_sun", "day_cream_spf", "none"],
      },
      { key: "sun_texture", codes: ["light_fluid_spray", "medium_cream", "rich_cream_oil", "no_matter"] },
      { key: "sun_self_tan", codes: ["regularly", "occasionally", "interested", "no"] },
    ],
  },

  ж_makeup: {
    id: "female_makeup",
    questions: [
      {
        key: "makeup_frequency",
        codes: ["daily_full", "daily_light", "few_times_week", "special_occasions"],
      },
      { key: "makeup_zones", codes: ["complexion", "eyes", "brows", "lips", "cheeks"] },
      {
        key: "makeup_routine",
        codes: [
          "primer",
          "foundation",
          "concealer",
          "powder",
          "blush",
          "bronzer_contour",
          "highlighter",
          "eyeshadow",
          "eyeliner",
          "mascara",
          "brow_products",
          "lipstick",
          "gloss_tint",
          "setting_spray",
        ],
      },
      {
        key: "makeup_interests",
        codes: [
          "new_foundation_formats",
          "cream_blush_contour",
          "colored_liners_shadows",
          "long_wear_tints",
          "brow_lamination",
          "none",
        ],
      },
      { key: "makeup_finish", codes: ["matte", "natural_glow", "full_coverage", "sheer", "long_wear"] },
      { key: "makeup_tools", codes: ["brushes", "sponges", "fingers", "kit_applicators"] },
      {
        key: "makeup_removal",
        codes: ["micellar_water", "cleansing_oil", "milk_cream", "biphase_eye", "wipes"],
      },
      { key: "makeup_palette", codes: ["nude", "warm", "cool", "bright", "varied"] },
    ],
  },

  ж_perfume: {
    id: "shared_perfume",
    questions: [
      { key: "perfume_frequency", codes: ["daily", "few_times_week", "special_occasions", "rarely"] },
      { key: "perfume_collection", codes: ["one", "two_three", "four_seven", "more_than_seven"] },
      {
        key: "perfume_routine",
        codes: ["edp", "edt", "parfum", "shower_gel", "body_milk", "deodorant", "hair_mist"],
      },
      { key: "perfume_intensity", codes: ["light", "moderate", "noticeable", "depends"] },
      {
        key: "perfume_families",
        codes: [
          "floral",
          "oriental_spicy",
          "woody",
          "fresh_citrus",
          "fougere",
          "chypre",
          "gourmand",
          "aquatic",
        ],
      },
      { key: "perfume_type", codes: ["classic", "new_from_known_brands", "niche", "everything"] },
    ],
  },

  ж_home: {
    id: "shared_home",
    questions: [
      {
        key: "home_zones",
        codes: ["living_room", "bedroom", "bathroom", "hallway", "workspace", "none_yet"],
        exclusive: [5],
      },
      {
        key: "home_mood",
        codes: ["cozy_warm", "fresh_clean", "relax_sleep", "energy_focus", "luxury_festive"],
      },
      {
        key: "home_formats",
        codes: ["reed_diffuser", "candle", "room_spray", "textile_fragrance", "electric_diffuser", "sachet"],
      },
    ],
  },
};

/** Мужские ветки прототипа, являющиеся копиями женских → общие ветки. */
export const SHARED_ALIASES: Record<string, string> = {
  м_sun: "ж_sun",
  м_perfume: "ж_perfume",
  м_home: "ж_home",
};

/** Автодетект взаимоисключающих вариантов (только для multi). ТЗ 6.3.5. */
export const EXCLUSIVE_PATTERN =
  /^(Ничего|Не использую|Нет, не пользуюсь|Пока ничего|Пока нигде|Всё нормально|Не использую средства)/u;
