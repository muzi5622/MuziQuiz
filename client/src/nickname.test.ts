import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { AVATAR_VARIANTS, RESERVED_AVATAR_INDEX, NicknameSchema, avatarFor } from '@localmenti/shared';
import { Avatar } from './players.js';
import { JoinPage } from './lobby.js';

describe('nickname input and automatic characters', () => {
  it('renders a browser constraint matching the server character policy', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(JoinPage)));
    const pattern = html.match(/id="join-nickname"[^>]*pattern="([^"]+)"/)?.[1];
    expect(pattern).toBeDefined();
    const browserConstraint = new RegExp(`^(?:${pattern})$`, 'v');
    for (const name of ['Alex', '1234', 'Alex123', 'علی', 'Ａlex', 'Ali Khan', 'Alex!', 'a_b', '@a', '🐼', 'ⓐ', 'a-b']) {
      expect(browserConstraint.test(name), name).toBe(NicknameSchema.safeParse(name).success);
    }
    expect(html).toContain('No spaces or symbols.');
  });
  it('has 200 distinct stable emoji/color combinations without network assets', () => {
    const avatars = Array.from({ length: 200 }, (_, index) => avatarFor(index));
    expect(new Set(avatars.map(avatar => `${avatar.icon}:${avatar.color}`)).size).toBe(200);
    expect(avatarFor(123)).toEqual(avatars[123]);
  });
  it('extends the palette without changing existing avatar identities', () => {
    const avatars = Array.from({ length:AVATAR_VARIANTS },(_,index) => avatarFor(index));
    expect(new Set(avatars.map(avatar => `${avatar.icon}:${avatar.color}`)).size).toBe(AVATAR_VARIANTS);
    expect(avatarFor(0).icon).toBe('🦊'); expect(avatarFor(240).icon).toBe('🍩');
  });
  it('keeps the reserved skull out of ordinary variants and marks its callout', () => {
    expect(Array.from({ length:AVATAR_VARIANTS },(_,index) => avatarFor(index).icon)).not.toContain('☠️');
    expect(avatarFor(RESERVED_AVATAR_INDEX).icon).toBe('☠️');
    expect(renderToStaticMarkup(createElement(Avatar,{ index:RESERVED_AVATAR_INDEX }))).toContain('avatar-reserved');
  });
});
