-- Sanko Vault — preferred_language becomes optional
--
-- Why: this column is passed to Whisper as its decoding language, and Whisper's
-- `language` argument does not hint — it locks the decoder and skips detection
-- entirely. Because the column defaulted to 'en', every practitioner who had not
-- yet chosen a language had their voice notes decoded as English. That failure is
-- silent: Yorùbá audio forced through an English decoder comes back as fluent
-- English-sounding nonsense, at high confidence, so the low-confidence guard in
-- inboundMedia.js never fires on it.
--
-- After this migration: null means "not stated" (detect the language), and a
-- stored code means the practitioner actually chose it.

alter table practitioners alter column preferred_language drop default;

-- Existing rows are ambiguous — a stored 'en' may be the old default or a real
-- choice. Rows that never got past first contact (no display_name) cannot have
-- chosen anything, so clearing those is safe and fixes the practitioners most
-- likely to be affected. Anyone onboarded is left alone; set_profile corrects
-- them the next time they say what they speak.
update practitioners
   set preferred_language = null
 where preferred_language = 'en'
   and display_name is null;
