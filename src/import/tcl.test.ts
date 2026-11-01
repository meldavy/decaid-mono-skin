import { describe, expect, it } from 'vitest'
import { parseTclProfile, tclWords } from './tcl'

const SAMPLE = `profile_title {Mono/Lever test}
author Mono
profile_notes {A long soak, then a falling pressure.}
beverage_type espresso
final_desired_shot_weight_advanced 38
settings_profile_type settings_2c
advanced_shot {
  {name soak pump flow transition fast temperature 94 sensor coffee flow 4 pressure 0 seconds 12 weight 0 volume 0 exit_if 1 exit_type pressure_over exit_pressure_over 3 exit_flow_under 0 max_flow_or_pressure 0 max_flow_or_pressure_range 0.6}
  {name {fall away} pump pressure transition smooth temperature 93.5 sensor water flow 0 pressure 6 seconds 30 weight 0 volume 0 exit_if 0 exit_type pressure_over exit_pressure_over 0 max_flow_or_pressure 2.5 max_flow_or_pressure_range 0.6}
}`

describe('LIB-13 .tcl profiles', () => {
  it('splits Tcl words, keeping {braced groups} (nested) together', () => {
    expect(tclWords('a {b c} {d {e f}} "g h"')).toEqual(['a', 'b c', 'd {e f}', 'g h'])
  })

  it('reads an advanced (settings_2c) profile into a Decent v2 profile', () => {
    const p = parseTclProfile(SAMPLE)
    expect(p).toMatchObject({ title: 'Mono/Lever test', author: 'Mono', beverage_type: 'espresso', target_weight: 38 })
    expect(p.steps).toHaveLength(2)
    expect(p.steps[0]).toMatchObject({ name: 'soak', pump: 'flow', flow: 4, pressure: null, seconds: 12, exit: { type: 'pressure', condition: 'over', value: 3 }, limiter: null })
    expect(p.steps[1]).toMatchObject({ name: 'fall away', pump: 'pressure', pressure: 6, transition: 'smooth', sensor: 'water', exit: null, limiter: { value: 2.5, range: 0.6 } })
  })

  it("explains what it can't import", () => {
    expect(() => parseTclProfile('profile_title {Old}\nsettings_profile_type settings_2a\n')).toThrow('Older “simple”')
    expect(() => parseTclProfile('not a profile {')).toThrow("isn't a profile")
    expect(() => parseTclProfile('profile_title {Empty}\nsettings_profile_type settings_2c\nadvanced_shot {}')).toThrow('No stages')
  })
})
