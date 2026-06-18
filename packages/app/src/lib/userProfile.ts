import { useEffect, useState } from 'react';

export interface UserProfile {
  displayName: string;
  handle: string;
  avatarUrl: string;
  email: string;
}

export const USER_PROFILE_STORAGE_KEY = 'entity.user.profile.v1';
export const USER_PROFILE_CHANGED_EVENT = 'entity:user-profile-changed';

export const DEFAULT_USER_PROFILE: UserProfile = {
  displayName: 'User',
  handle: 'user',
  avatarUrl: '/agent-avatars/default.jpg',
  email: '',
};

function cleanProfile(value: Partial<UserProfile> | null | undefined): UserProfile {
  return {
    displayName: value?.displayName?.trim() || DEFAULT_USER_PROFILE.displayName,
    handle: value?.handle?.trim() || DEFAULT_USER_PROFILE.handle,
    avatarUrl: value?.avatarUrl?.trim() || DEFAULT_USER_PROFILE.avatarUrl,
    email: value?.email?.trim() || DEFAULT_USER_PROFILE.email,
  };
}

export function readUserProfile(): UserProfile {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_USER_PROFILE;
  }

  try {
    const raw = window.localStorage.getItem(USER_PROFILE_STORAGE_KEY);
    if (!raw) {
      return DEFAULT_USER_PROFILE;
    }
    return cleanProfile(JSON.parse(raw) as Partial<UserProfile>);
  } catch {
    return DEFAULT_USER_PROFILE;
  }
}

export function writeUserProfile(profile: Partial<UserProfile>): UserProfile {
  const next = cleanProfile(profile);
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(USER_PROFILE_STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent(USER_PROFILE_CHANGED_EVENT, { detail: next }));
  }
  return next;
}

export function useUserProfile(): [UserProfile, (profile: Partial<UserProfile>) => UserProfile] {
  const [profile, setProfile] = useState<UserProfile>(() => readUserProfile());

  useEffect(() => {
    const refresh = () => setProfile(readUserProfile());
    window.addEventListener('storage', refresh);
    window.addEventListener(USER_PROFILE_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(USER_PROFILE_CHANGED_EVENT, refresh);
    };
  }, []);

  const updateProfile = (next: Partial<UserProfile>) => {
    const saved = writeUserProfile(next);
    setProfile(saved);
    return saved;
  };

  return [profile, updateProfile];
}
