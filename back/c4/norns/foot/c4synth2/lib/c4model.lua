-- lib/c4model.lua -- C4 preset-body decoder/encoder.
-- Generated from back/c4/src/c4Model.js WORKBENCH_CONTROL_SPECS; do not edit by hand.
-- decode(body) with body[0..127] int 0..255 returns display rows
-- { label, value, num }; raw()/set() read and write a single row's numeric
-- value in-place (Lua 5.1-safe, no bitwise ops). All rows are single-byte
-- (mask == max << shift, mask <= 255).

local m = {}

local ROWS = {
  { name='input1_gain', idx=0, type='knob', shift=0, mask=255, max=255, label='input1 gain' },
  { name='input2_gain', idx=1, type='knob', shift=0, mask=255, max=255, label='input2 gain' },
  { name='master_depth', idx=2, type='knob', shift=0, mask=255, max=255, label='master depth' },
  { name='mod_source', idx=3, type='knob', shift=0, mask=255, max=255, label='mod source' },
  { name='bass', idx=4, type='knob', shift=0, mask=255, max=255, label='bass' },
  { name='treble', idx=5, type='knob', shift=0, mask=255, max=255, label='treble' },
  { name='mix', idx=6, type='knob', shift=0, mask=255, max=255, label='mix' },
  { name='lo_retain', idx=7, type='knob', shift=0, mask=255, max=255, label='lo retain' },
  { name='output', idx=8, type='knob', shift=0, mask=255, max=255, label='output' },
  { name='output_balance', idx=9, type='knob', shift=0, mask=255, max=255, label='output balance' },
  { name='voice1_level', idx=10, type='knob', shift=0, mask=255, max=255, label='voice1 level' },
  { name='voice1_pan', idx=11, type='knob', shift=0, mask=255, max=255, label='voice1 pan' },
  { name='voice1_detune', idx=12, type='knob', shift=0, mask=255, max=255, label='voice1 detune' },
  { name='voice1_tremolo', idx=13, type='knob', shift=0, mask=255, max=255, label='voice1 tremolo' },
  { name='voice1_octave', idx=14, type='select', shift=0, mask=7, max=7, label='voice1 octave', opts={'Oct +3','Oct +2','Oct +1','Oct --','Oct -1','Oct -2','Oct -3'} },
  { name='voice1_semitone', idx=14, type='select', shift=3, mask=248, max=31, label='voice1 semitone', opts={'Semi +11','Semi +10','Semi +9','Semi +8','Semi +7','Semi +6','Semi +5','Semi +4','Semi +3','Semi +2','Semi +1','Semi --','Semi -1','Semi -2','Semi -3','Semi -4','Semi -5','Semi -6','Semi -7','Semi -8','Semi -9','Semi -10','Semi -11'} },
  { name='voice1_mode', idx=15, type='select', shift=0, mask=3, max=3, label='voice1 mode', opts={'Fixed Int','Int + Harm 1','Int + Seq 1'} },
  { name='voice1_source', idx=15, type='select', shift=2, mask=60, max=15, label='voice1 source', opts={'Stereo In','PolyPitch 1','PolyPitch 2','MonoPitch 1','MonoPitch 2','Saw 1','Saw 2','Sine 1','Sine 2','Square 1','Square 2','Mono In 1','Mono In 2'} },
  { name='voice1_envelope', idx=15, type='select', shift=6, mask=192, max=3, label='voice1 envelope', opts={'Env OFF','Env 1','Env 2'} },
  { name='voice1_destination', idx=16, type='select', shift=0, mask=3, max=3, label='voice1 destination', opts={'FilterDist','FilterOnly','Direct Out'} },
  { name='voice1_tremolo_source', idx=16, type='toggle', shift=2, mask=4, max=1, label='voice1 tremolo source' },
  { name='voice1_modulate', idx=16, type='toggle', shift=3, mask=8, max=1, label='voice1 modulate' },
  { name='voice1_enable', idx=16, type='toggle', shift=4, mask=240, max=15, label='voice1 enable' },
  { name='voice2_level', idx=17, type='knob', shift=0, mask=255, max=255, label='voice2 level' },
  { name='voice2_pan', idx=18, type='knob', shift=0, mask=255, max=255, label='voice2 pan' },
  { name='voice2_detune', idx=19, type='knob', shift=0, mask=255, max=255, label='voice2 detune' },
  { name='voice2_tremolo', idx=20, type='knob', shift=0, mask=255, max=255, label='voice2 tremolo' },
  { name='voice2_octave', idx=21, type='select', shift=0, mask=7, max=7, label='voice2 octave', opts={'Oct +3','Oct +2','Oct +1','Oct --','Oct -1','Oct -2','Oct -3'} },
  { name='voice2_semitone', idx=21, type='select', shift=3, mask=248, max=31, label='voice2 semitone', opts={'Semi +11','Semi +10','Semi +9','Semi +8','Semi +7','Semi +6','Semi +5','Semi +4','Semi +3','Semi +2','Semi +1','Semi --','Semi -1','Semi -2','Semi -3','Semi -4','Semi -5','Semi -6','Semi -7','Semi -8','Semi -9','Semi -10','Semi -11'} },
  { name='voice2_mode', idx=22, type='select', shift=0, mask=3, max=3, label='voice2 mode', opts={'Fixed Int','Int + Harm 1','Int + Seq 1'} },
  { name='voice2_source', idx=22, type='select', shift=2, mask=60, max=15, label='voice2 source', opts={'Stereo In','PolyPitch 1','PolyPitch 2','MonoPitch 1','MonoPitch 2','Saw 1','Saw 2','Sine 1','Sine 2','Square 1','Square 2','Mono In 1','Mono In 2'} },
  { name='voice2_envelope', idx=22, type='select', shift=6, mask=192, max=3, label='voice2 envelope', opts={'Env OFF','Env 1','Env 2'} },
  { name='voice2_destination', idx=23, type='select', shift=0, mask=3, max=3, label='voice2 destination', opts={'FilterDist','FilterOnly','Direct Out'} },
  { name='voice2_tremolo_source', idx=23, type='toggle', shift=2, mask=4, max=1, label='voice2 tremolo source' },
  { name='voice2_modulate', idx=23, type='toggle', shift=3, mask=8, max=1, label='voice2 modulate' },
  { name='voice2_enable', idx=23, type='toggle', shift=4, mask=240, max=15, label='voice2 enable' },
  { name='voice3_level', idx=24, type='knob', shift=0, mask=255, max=255, label='voice3 level' },
  { name='voice3_pan', idx=25, type='knob', shift=0, mask=255, max=255, label='voice3 pan' },
  { name='voice3_detune', idx=26, type='knob', shift=0, mask=255, max=255, label='voice3 detune' },
  { name='voice3_tremolo', idx=27, type='knob', shift=0, mask=255, max=255, label='voice3 tremolo' },
  { name='voice3_octave', idx=28, type='select', shift=0, mask=7, max=7, label='voice3 octave', opts={'Oct +3','Oct +2','Oct +1','Oct --','Oct -1','Oct -2','Oct -3'} },
  { name='voice3_semitone', idx=28, type='select', shift=3, mask=248, max=31, label='voice3 semitone', opts={'Semi +11','Semi +10','Semi +9','Semi +8','Semi +7','Semi +6','Semi +5','Semi +4','Semi +3','Semi +2','Semi +1','Semi --','Semi -1','Semi -2','Semi -3','Semi -4','Semi -5','Semi -6','Semi -7','Semi -8','Semi -9','Semi -10','Semi -11'} },
  { name='voice3_mode', idx=29, type='select', shift=0, mask=3, max=3, label='voice3 mode', opts={'Fixed Int','Int + Harm 1','Int + Seq 1'} },
  { name='voice3_source', idx=29, type='select', shift=2, mask=60, max=15, label='voice3 source', opts={'Stereo In','PolyPitch 1','PolyPitch 2','MonoPitch 1','MonoPitch 2','Saw 1','Saw 2','Sine 1','Sine 2','Square 1','Square 2','Mono In 1','Mono In 2'} },
  { name='voice3_envelope', idx=29, type='select', shift=6, mask=192, max=3, label='voice3 envelope', opts={'Env OFF','Env 1','Env 2'} },
  { name='voice3_destination', idx=30, type='select', shift=0, mask=3, max=3, label='voice3 destination', opts={'FilterDist','FilterOnly','Direct Out'} },
  { name='voice3_tremolo_source', idx=30, type='toggle', shift=2, mask=4, max=1, label='voice3 tremolo source' },
  { name='voice3_modulate', idx=30, type='toggle', shift=3, mask=8, max=1, label='voice3 modulate' },
  { name='voice3_enable', idx=30, type='toggle', shift=4, mask=240, max=15, label='voice3 enable' },
  { name='voice4_level', idx=31, type='knob', shift=0, mask=255, max=255, label='voice4 level' },
  { name='voice4_pan', idx=32, type='knob', shift=0, mask=255, max=255, label='voice4 pan' },
  { name='voice4_detune', idx=33, type='knob', shift=0, mask=255, max=255, label='voice4 detune' },
  { name='voice4_tremolo', idx=34, type='knob', shift=0, mask=255, max=255, label='voice4 tremolo' },
  { name='voice4_octave', idx=35, type='select', shift=0, mask=7, max=7, label='voice4 octave', opts={'Oct +3','Oct +2','Oct +1','Oct --','Oct -1','Oct -2','Oct -3'} },
  { name='voice4_semitone', idx=35, type='select', shift=3, mask=248, max=31, label='voice4 semitone', opts={'Semi +11','Semi +10','Semi +9','Semi +8','Semi +7','Semi +6','Semi +5','Semi +4','Semi +3','Semi +2','Semi +1','Semi --','Semi -1','Semi -2','Semi -3','Semi -4','Semi -5','Semi -6','Semi -7','Semi -8','Semi -9','Semi -10','Semi -11'} },
  { name='voice4_mode', idx=36, type='select', shift=0, mask=3, max=3, label='voice4 mode', opts={'Fixed Int','Int + Harm 1','Int + Seq 1'} },
  { name='voice4_source', idx=36, type='select', shift=2, mask=60, max=15, label='voice4 source', opts={'Stereo In','PolyPitch 1','PolyPitch 2','MonoPitch 1','MonoPitch 2','Saw 1','Saw 2','Sine 1','Sine 2','Square 1','Square 2','Mono In 1','Mono In 2'} },
  { name='voice4_envelope', idx=36, type='select', shift=6, mask=192, max=3, label='voice4 envelope', opts={'Env OFF','Env 1','Env 2'} },
  { name='voice4_destination', idx=37, type='select', shift=0, mask=3, max=3, label='voice4 destination', opts={'FilterDist','FilterOnly','Direct Out'} },
  { name='voice4_tremolo_source', idx=37, type='toggle', shift=2, mask=4, max=1, label='voice4 tremolo source' },
  { name='voice4_modulate', idx=37, type='toggle', shift=3, mask=8, max=1, label='voice4 modulate' },
  { name='voice4_enable', idx=37, type='toggle', shift=4, mask=240, max=15, label='voice4 enable' },
  { name='filter1_depth', idx=38, type='knob', shift=0, mask=255, max=255, label='filter1 depth' },
  { name='filter1_frequency', idx=39, type='knob', shift=0, mask=255, max=255, label='filter1 freq' },
  { name='filter1_q', idx=40, type='knob', shift=0, mask=255, max=255, label='filter1 q' },
  { name='filter1_type', idx=41, type='select', shift=0, mask=31, max=31, label='filter1 type', opts={'3 Pll LP','6 Pole LP','2 Pole LP','Notch LP Pk','Notch Notch LP','Pk Notch LP','LP Pk Pk','2 Pll LP','4 Pole LP','LP Pk','4 Pole LP Pk','Pk 4 Pole LP','Bandpass 1','Pk','Triple Pk 1','Triple Pk 2','Triple Pk 3','Triple Pk 4','Pk Notch Pk','Notch Pk Notch','2st Phaser','3st Phaser','1st Phaser','HP','HP Peak','Wah','Bandpass 2','Double Pk','6 PoleAllPass'} },
  { name='filter1_envelope', idx=41, type='select', shift=5, mask=32, max=1, label='filter1 env', opts={'Env/LFO 1','Env/LFO 2'} },
  { name='filter1_invert', idx=41, type='toggle', shift=6, mask=64, max=1, label='filter1 invert' },
  { name='filter1_enable', idx=41, type='toggle', shift=7, mask=128, max=1, label='filter1 enable' },
  { name='filter1_pitch_track', idx=42, type='select', shift=0, mask=3, max=3, label='filter1 pitch', opts={'OFF','1/3 Octave','2/3 Octave','1 Octave'} },
  { name='mix1_destination', idx=42, type='select', shift=2, mask=12, max=3, label='mix1 dest', opts={'Out 1 only','Out 1 + 2','Out 2 only'} },
  { name='mix1_enable', idx=42, type='toggle', shift=4, mask=240, max=15, label='mix1 enable' },
  { name='filter2_depth', idx=43, type='knob', shift=0, mask=255, max=255, label='filter2 depth' },
  { name='filter2_frequency', idx=44, type='knob', shift=0, mask=255, max=255, label='filter2 freq' },
  { name='filter2_q', idx=45, type='knob', shift=0, mask=255, max=255, label='filter2 q' },
  { name='filter2_type', idx=46, type='select', shift=0, mask=31, max=31, label='filter2 type', opts={'3 Pll LP','6 Pole LP','2 Pole LP','Notch LP Pk','Notch Notch LP','Pk Notch LP','LP Pk Pk','2 Pll LP','4 Pole LP','LP Pk','4 Pole LP Pk','Pk 4 Pole LP','Bandpass 1','Pk','Triple Pk 1','Triple Pk 2','Triple Pk 3','Triple Pk 4','Pk Notch Pk','Notch Pk Notch','2st Phaser','3st Phaser','1st Phaser','HP','HP Peak','Wah','Bandpass 2','Double Pk','6 PoleAllPass'} },
  { name='filter2_envelope', idx=46, type='select', shift=5, mask=32, max=1, label='filter2 env', opts={'Env/LFO 1','Env/LFO 2'} },
  { name='filter2_invert', idx=46, type='toggle', shift=6, mask=64, max=1, label='filter2 invert' },
  { name='filter2_enable', idx=46, type='toggle', shift=7, mask=128, max=1, label='filter2 enable' },
  { name='filter2_pitch_track', idx=47, type='select', shift=0, mask=3, max=3, label='filter2 pitch', opts={'OFF','1/3 Octave','2/3 Octave','1 Octave'} },
  { name='mix2_destination', idx=47, type='select', shift=2, mask=12, max=3, label='mix2 dest', opts={'Out 1 only','Out 1 + 2','Out 2 only'} },
  { name='mix2_enable', idx=47, type='toggle', shift=4, mask=240, max=15, label='mix2 enable' },
  { name='envelope1_sensitivity', idx=48, type='knob', shift=0, mask=255, max=255, label='env1 sens' },
  { name='envelope1_speed', idx=49, type='knob', shift=0, mask=255, max=255, label='env1 speed' },
  { name='envelope1_gate', idx=50, type='knob', shift=0, mask=255, max=255, label='env1 gate' },
  { name='envelope1_type', idx=51, type='select', shift=0, mask=15, max=15, label='env1 type', opts={'+At jDec','+++At jDec','Wide1 j At/Dec','Wide2 ++Dec','Snappy','Swell','adsr1 j At/Dec','adsr2 +At jDec','adsr3 j At/Dec','adsr4','adsr5','adsr6 -At +Dec'} },
  { name='envelope1_input', idx=51, type='select', shift=4, mask=240, max=15, label='env1 input', opts={'Audio In 1','Audio In 2'} },
  { name='envelope2_sensitivity', idx=52, type='knob', shift=0, mask=255, max=255, label='env2 sens' },
  { name='envelope2_speed', idx=53, type='knob', shift=0, mask=255, max=255, label='env2 speed' },
  { name='envelope2_gate', idx=54, type='knob', shift=0, mask=255, max=255, label='env2 gate' },
  { name='envelope2_type', idx=55, type='select', shift=0, mask=15, max=15, label='env2 type', opts={'+At jDec','+++At jDec','Wide1 j At/Dec','Wide2 ++Dec','Snappy','Swell','adsr1 j At/Dec','adsr2 +At jDec','adsr3 j At/Dec','adsr4','adsr5','adsr6 -At +Dec'} },
  { name='envelope2_input', idx=55, type='select', shift=4, mask=240, max=15, label='env2 input', opts={'Audio In 1','Audio In 2'} },
  { name='distortion_drive', idx=56, type='knob', shift=0, mask=255, max=255, label='dist drive' },
  { name='distortion_mix', idx=57, type='knob', shift=0, mask=255, max=255, label='dist mix' },
  { name='distortion_output', idx=58, type='knob', shift=0, mask=255, max=255, label='dist output' },
  { name='distortion_type', idx=59, type='select', shift=0, mask=15, max=15, label='dist type', opts={'Mild','Moderate','HeavyBassy','SmplReducer','OctFuzz','GatedFuzz','FldvrLight','FldvrHeavy','DblFldvr','DblOctFuzz','TripleFold','SingleClip','MaxFldvr'} },
  { name='distortion_enable', idx=59, type='toggle', shift=4, mask=240, max=15, label='dist enable' },
  { name='fm_sine1', idx=60, type='knob', shift=0, mask=255, max=255, label='fm sine1' },
  { name='fm_sine2', idx=61, type='knob', shift=0, mask=255, max=255, label='fm sine2' },
  { name='fm_sine1_input', idx=62, type='select', shift=0, mask=1, max=1, label='fm sine1 in', opts={'LFO 1','LFO 2'} },
  { name='fm_sine2_input', idx=62, type='select', shift=1, mask=254, max=127, label='fm sine2 in', opts={'LFO 1','LFO 2'} },
  { name='mono_pitch_filter1', idx=63, type='knob', shift=0, mask=255, max=255, label='monoPitchFltr1' },
  { name='mono_pitch_filter2', idx=64, type='knob', shift=0, mask=255, max=255, label='monoPitchFltr2' },
  { name='lfo_speed', idx=65, type='knob', shift=0, mask=255, max=255, label='lfo speed' },
  { name='lfo_env_to_speed', idx=66, type='knob', shift=0, mask=255, max=255, label='lfo env2speed' },
  { name='lfo_env_to_depth', idx=67, type='knob', shift=0, mask=255, max=255, label='lfo env2depth' },
  { name='lfo_2_phase', idx=68, type='knob', shift=0, mask=255, max=255, label='lfo2 phase' },
  { name='lfo_2_multiply', idx=69, type='select', shift=0, mask=255, max=255, label='lfo2 mult', opts={'lfo2 = lfo1','lfo2 = 2x lfo1','lfo2 = 3x lfo1','lfo2 = 4x lfo1','lfo2 = 5x lfo1','lfo2 = 6x lfo1','lfo2 = 7x lfo1','lfo2 = 8x lfo1','lfo2 = 16x lfo1','lfo2 = 32x lfo1','lfo2 = 64x lfo1'} },
  { name='lfo_shape', idx=70, type='select', shift=0, mask=15, max=15, label='lfo shape', opts={'Sine','Pluck','Square','RisingSaw','FallingSaw','3ngl','SampleHold','4 Step','4 Step + S&H','Sine + S&H','SineRiseSkew','SineFallSkew','3anglRiseSkew','3anglFallSkew'} },
  { name='lfo_restart', idx=70, type='toggle', shift=4, mask=16, max=1, label='lfo restart' },
  { name='lfo_beat_division', idx=70, type='select', shift=5, mask=224, max=7, label='lfoBeatDiv', opts={'Whole','Half','Quarter','Eighth','Triplet','Sixteenth'} },
  { name='sequencer1_steps', idx=75, type='select', shift=0, mask=255, max=255, label='seq1 steps', opts={'2 Steps','3 Steps','4 Steps','5 Steps','6 Steps','7 Steps','8 Steps','9 Steps','10 Steps','11 Steps','12 Steps','13 Steps','14 Steps','15 Steps','16 Steps'} },
  { name='sequencer1_value0', idx=76, type='knob', shift=0, mask=255, max=255, label='seq1 value0' },
  { name='sequencer1_value1', idx=77, type='knob', shift=0, mask=255, max=255, label='seq1 value1' },
  { name='sequencer1_value2', idx=78, type='knob', shift=0, mask=255, max=255, label='seq1 value2' },
  { name='sequencer1_value3', idx=79, type='knob', shift=0, mask=255, max=255, label='seq1 value3' },
  { name='sequencer1_value4', idx=80, type='knob', shift=0, mask=255, max=255, label='seq1 value4' },
  { name='sequencer1_value5', idx=81, type='knob', shift=0, mask=255, max=255, label='seq1 value5' },
  { name='sequencer1_value6', idx=82, type='knob', shift=0, mask=255, max=255, label='seq1 value6' },
  { name='sequencer1_value7', idx=83, type='knob', shift=0, mask=255, max=255, label='seq1 value7' },
  { name='sequencer1_value8', idx=84, type='knob', shift=0, mask=255, max=255, label='seq1 value8' },
  { name='sequencer1_value9', idx=85, type='knob', shift=0, mask=255, max=255, label='seq1 value9' },
  { name='sequencer1_value10', idx=86, type='knob', shift=0, mask=255, max=255, label='seq1 value10' },
  { name='sequencer1_value11', idx=87, type='knob', shift=0, mask=255, max=255, label='seq1 value11' },
  { name='sequencer1_value12', idx=88, type='knob', shift=0, mask=255, max=255, label='seq1 value12' },
  { name='sequencer1_value13', idx=89, type='knob', shift=0, mask=255, max=255, label='seq1 value13' },
  { name='sequencer1_value14', idx=90, type='knob', shift=0, mask=255, max=255, label='seq1 value14' },
  { name='sequencer1_value15', idx=91, type='knob', shift=0, mask=255, max=255, label='seq1 value15' },
  { name='sequencer2_steps', idx=92, type='select', shift=0, mask=255, max=255, label='seq2 steps', opts={'2 Steps','3 Steps','4 Steps','5 Steps','6 Steps','7 Steps','8 Steps','9 Steps','10 Steps','11 Steps','12 Steps','13 Steps','14 Steps','15 Steps','16 Steps'} },
  { name='sequencer2_value0', idx=93, type='knob', shift=0, mask=255, max=255, label='seq2 value0' },
  { name='sequencer2_value1', idx=94, type='knob', shift=0, mask=255, max=255, label='seq2 value1' },
  { name='sequencer2_value2', idx=95, type='knob', shift=0, mask=255, max=255, label='seq2 value2' },
  { name='sequencer2_value3', idx=96, type='knob', shift=0, mask=255, max=255, label='seq2 value3' },
  { name='sequencer2_value4', idx=97, type='knob', shift=0, mask=255, max=255, label='seq2 value4' },
  { name='sequencer2_value5', idx=98, type='knob', shift=0, mask=255, max=255, label='seq2 value5' },
  { name='sequencer2_value6', idx=99, type='knob', shift=0, mask=255, max=255, label='seq2 value6' },
  { name='sequencer2_value7', idx=100, type='knob', shift=0, mask=255, max=255, label='seq2 value7' },
  { name='sequencer2_value8', idx=101, type='knob', shift=0, mask=255, max=255, label='seq2 value8' },
  { name='sequencer2_value9', idx=102, type='knob', shift=0, mask=255, max=255, label='seq2 value9' },
  { name='sequencer2_value10', idx=103, type='knob', shift=0, mask=255, max=255, label='seq2 value10' },
  { name='sequencer2_value11', idx=104, type='knob', shift=0, mask=255, max=255, label='seq2 value11' },
  { name='sequencer2_value12', idx=105, type='knob', shift=0, mask=255, max=255, label='seq2 value12' },
  { name='sequencer2_value13', idx=106, type='knob', shift=0, mask=255, max=255, label='seq2 value13' },
  { name='sequencer2_value14', idx=107, type='knob', shift=0, mask=255, max=255, label='seq2 value14' },
  { name='sequencer2_value15', idx=108, type='knob', shift=0, mask=255, max=255, label='seq2 value15' },
  { name='harmony_tuning', idx=109, type='knob', shift=0, mask=255, max=255, label='harm tuning' },
  { name='harmony_key', idx=110, type='select', shift=0, mask=15, max=15, label='harm key', opts={'A','A#','B','C','C#','D','D#','E','F','F#','G','G#'} },
  { name='harmony_interval1', idx=110, type='select', shift=4, mask=240, max=15, label='harm int1', opts={'+2nd','+3rd','+4th','+5th','+6th','+7th'} },
  { name='harmony_mode', idx=111, type='select', shift=0, mask=31, max=31, label='harm mode', opts={'IonianMajor','Dorian','Phrygian','Lydian','Mixolydian','AeolianNatMin','Locrian','HarmMin','LocrianNat 6','Ionian #5','Dorian #4','PhrygianNat 3','Lydian #2','Altered bb7','Jazz Min','PhrygianNat 6','Lydian #5','Lydian b7','Mixolydian b6','LocrianNat 2','Altered Scale','Half-Whole','Whole-Half'} },
  { name='harmony_interval2', idx=111, type='select', shift=5, mask=224, max=7, label='harm int2', opts={'+2nd','+3rd','+4th','+5th','+6th','+7th'} },
  { name='pitch_detect_input', idx=112, type='select', shift=0, mask=1, max=1, label='pitch in', opts={'Audio In 1','Audio In 2'} },
  { name='pitch_detect_mode', idx=112, type='select', shift=1, mask=2, max=1, label='pitch mode', opts={'Speed','Accuracy'} },
  { name='pitch_detect_low_note', idx=112, type='select', shift=2, mask=252, max=63, label='pitch detect low note', opts={'G2','F#2','F2','E2 6-StrGuit','D#2','D2','C#2','C2','B1 7-StrGuit','A#1','A1','G#1','G1','F#1','F1','E1 4-StrBass','D#1','D1','C#1','C1','B0 5-StrBass'} },
  { name='pitch_detect_high_note', idx=113, type='select', shift=0, mask=255, max=255, label='pitch detect high note', opts={'E6 Guit24fr','D#6','D6 Guit22fr','C#6','C6','B5','A#5','A5','G#5','G5','F#5','F5','E5','D#5','D5','C#5','C5','B4','A#4','A4','G#4','G4 Bass24fr','F#4','F4','E4','D#4 Bass20fr','D4','C#4','C4','B3','A#3','A3'} },
  { name='knob1_assign', idx=114, type='select', shift=0, mask=255, max=255, label='knob1 assign', opts={'in1 gain','in2 gain','master depth','mod source','bass','treble','mix','out','out balance','voice1 level','voice1 pan','voice1 detune','voice1 tremolo','voice2 level','voice2 pan','voice2 detune','voice2 tremolo','voice3 level','voice3 pan','voice3 detune','voice3 tremolo','voice4 level','voice4 pan','voice4 detune','voice4 tremolo','dist drive','dist mix','dist out','filter1 depth','filter1 freq','filter1 q','filter2 depth','filter2 freq','filter2 q','env1 sens','env1 speed','env1 gate','env2 sens','env2 speed','env2 gate','fm sine1','fm sine2','monoPitchFltr1','monoPitchFltr2','lfo speed','lfo env2speed','lfo env2depth','lfo2 phase'} },
  { name='knob2_assign', idx=115, type='select', shift=0, mask=255, max=255, label='knob2 assign', opts={'in1 gain','in2 gain','master depth','mod source','bass','treble','mix','out','out balance','voice1 level','voice1 pan','voice1 detune','voice1 tremolo','voice2 level','voice2 pan','voice2 detune','voice2 tremolo','voice3 level','voice3 pan','voice3 detune','voice3 tremolo','voice4 level','voice4 pan','voice4 detune','voice4 tremolo','dist drive','dist mix','dist out','filter1 depth','filter1 freq','filter1 q','filter2 depth','filter2 freq','filter2 q','env1 sens','env1 speed','env1 gate','env2 sens','env2 speed','env2 gate','fm sine1','fm sine2','monoPitchFltr1','monoPitchFltr2','lfo speed','lfo env2speed','lfo env2depth','lfo2 phase'} },
  { name='routing_option', idx=116, type='select', shift=0, mask=7, max=7, label='routing option', opts={'Auto','Single In 1','Dual In','Ext Loop'} },
  { name='filter2_correction', idx=116, type='toggle', shift=3, mask=8, max=1, label='filter2 corr' },
  { name='on_off_status', idx=116, type='toggle', shift=4, mask=16, max=1, label='on off status' },
  { name='ext_control_enable', idx=116, type='toggle', shift=5, mask=32, max=1, label='ext control on' },
  { name='lfo_midi_clock_sync', idx=116, type='toggle', shift=6, mask=192, max=3, label='midi clock' },
  { name='ext1_destination', idx=117, type='select', shift=0, mask=63, max=63, label='ext1 dest', opts={'in1 gain','in2 gain','master depth','mod source','bass','treble','mix','out','out balance','voice1 level','voice1 pan','voice1 detune','voice1 tremolo','voice2 level','voice2 pan','voice2 detune','voice2 tremolo','voice3 level','voice3 pan','voice3 detune','voice3 tremolo','voice4 level','voice4 pan','voice4 detune','voice4 tremolo','dist drive','dist mix','dist out','filter1 depth','filter1 freq','filter1 q','filter2 depth','filter2 freq','filter2 q','env1 sens','env1 speed','env1 gate','env2 sens','env2 speed','env2 gate','fm sine1','fm sine2','monoPitchFltr1','monoPitchFltr2','lfo speed','lfo env2speed','lfo env2depth','lfo2 phase','Ext Mod'} },
  { name='ext1_source', idx=117, type='select', shift=6, mask=192, max=3, label='ext1 source', opts={'OFF','ExpIn X','ExpIn Y','Hub/midi ExpIn'} },
  { name='ext1_min', idx=118, type='knob', shift=0, mask=255, max=255, label='ext1 min' },
  { name='ext1_max', idx=119, type='knob', shift=0, mask=255, max=255, label='ext1 max' },
  { name='ext2_destination', idx=120, type='select', shift=0, mask=63, max=63, label='ext2 dest', opts={'in1 gain','in2 gain','master depth','mod source','bass','treble','mix','out','out balance','voice1 level','voice1 pan','voice1 detune','voice1 tremolo','voice2 level','voice2 pan','voice2 detune','voice2 tremolo','voice3 level','voice3 pan','voice3 detune','voice3 tremolo','voice4 level','voice4 pan','voice4 detune','voice4 tremolo','dist drive','dist mix','dist out','filter1 depth','filter1 freq','filter1 q','filter2 depth','filter2 freq','filter2 q','env1 sens','env1 speed','env1 gate','env2 sens','env2 speed','env2 gate','fm sine1','fm sine2','monoPitchFltr1','monoPitchFltr2','lfo speed','lfo env2speed','lfo env2depth','lfo2 phase','Ext Mod'} },
  { name='ext2_source', idx=120, type='select', shift=6, mask=192, max=3, label='ext2 source', opts={'OFF','ExpIn X','ExpIn Y','Hub/midi ExpIn'} },
  { name='ext2_min', idx=121, type='knob', shift=0, mask=255, max=255, label='ext2 min' },
  { name='ext2_max', idx=122, type='knob', shift=0, mask=255, max=255, label='ext2 max' },
  { name='ext3_destination', idx=123, type='select', shift=0, mask=63, max=63, label='ext3 dest', opts={'in1 gain','in2 gain','master depth','mod source','bass','treble','mix','out','out balance','voice1 level','voice1 pan','voice1 detune','voice1 tremolo','voice2 level','voice2 pan','voice2 detune','voice2 tremolo','voice3 level','voice3 pan','voice3 detune','voice3 tremolo','voice4 level','voice4 pan','voice4 detune','voice4 tremolo','dist drive','dist mix','dist out','filter1 depth','filter1 freq','filter1 q','filter2 depth','filter2 freq','filter2 q','env1 sens','env1 speed','env1 gate','env2 sens','env2 speed','env2 gate','fm sine1','fm sine2','monoPitchFltr1','monoPitchFltr2','lfo speed','lfo env2speed','lfo env2depth','lfo2 phase','Ext Mod'} },
  { name='ext3_source', idx=123, type='select', shift=6, mask=192, max=3, label='ext3 source', opts={'OFF','ExpIn X','ExpIn Y','Hub/midi ExpIn'} },
  { name='ext3_min', idx=124, type='knob', shift=0, mask=255, max=255, label='ext3 min' },
  { name='ext3_max', idx=125, type='knob', shift=0, mask=255, max=255, label='ext3 max' },
}

local function display(r, raw)
  if r.type == 'knob' then
    return tostring(raw)
  elseif r.type == 'toggle' then
    return raw == 0 and 'off' or 'on'
  else
    return r.opts and (r.opts[raw + 1] or tostring(raw)) or tostring(raw)
  end
end

-- Decode the 128-byte preset body into display rows.
function m.decode(body)
  local rows = {}
  for i = 1, #ROWS do
    local r = ROWS[i]
    local label = r.label
    local raw = math.floor((body[r.idx] or 0) / (2 ^ r.shift)) % (r.max + 1)
    rows[#rows + 1] = { label = label, value = display(r, raw), num = raw }
  end
  return rows
end

function m.row(rownum)
  return ROWS[rownum]
end

function m.count()
  return #ROWS
end

-- Raw numeric value (0..max) of a row in a body.
function m.raw(body, rownum)
  local r = ROWS[rownum]
  return math.floor((body[r.idx] or 0) / (2 ^ r.shift)) % (r.max + 1)
end

-- Display string for a row's numeric value.
function m.display(rownum, raw)
  return display(ROWS[rownum], raw)
end

-- Set a row's numeric value in-place in body[0..127]; returns body.
-- Recomposes the byte from its low bits + new field + high bits without
-- touching the neighbouring fields (no bitwise ops in Lua 5.1).
function m.set(body, rownum, raw)
  local r = ROWS[rownum]
  local b = body[r.idx] or 0
  local lvl = 2 ^ r.shift
  local field = math.floor(b / lvl) % (r.max + 1)
  local lo = b % lvl
  raw = raw % (r.max + 1)
  body[r.idx] = math.floor((math.floor(b / lvl) - field + raw) * lvl) + lo
  return body
end

return m
