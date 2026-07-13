import { makeLocalesTest } from '@hcengineering/platform'
it('Locales are equal', makeLocalesTest(async (lang) => await import(`../../lang/${lang}.json`)))
