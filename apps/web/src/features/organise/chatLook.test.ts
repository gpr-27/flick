import { expect, it } from 'vitest';
import { getChatLook, isHexColor, parseLooks, setChatLook } from './chatLook';

it('validates stored looks', () => {
  expect(isHexColor('#12abEF')).toBe(true);
  expect(isHexColor('red')).toBe(false);
  expect(
    parseLooks('{"a":{"accent":"#112233","sound":"pop"},"b":{"accent":"x","sound":"zzz"}}'),
  ).toEqual({
    a: { accent: '#112233', sound: 'pop' },
    b: {},
  });
  expect(parseLooks('nonsense')).toEqual({});
});
it('stores a look per chat', () => {
  setChatLook('c1', { accent: '#112233' });
  expect(getChatLook('c1').accent).toBe('#112233');
  expect(getChatLook('c2')).toEqual({});
});
