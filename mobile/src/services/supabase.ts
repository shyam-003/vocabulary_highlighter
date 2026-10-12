import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Default configuration (can be loaded from .env EXPO_PUBLIC_* variables or set here)
export const DEFAULT_SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL || '').trim();
export const DEFAULT_SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || '').trim();

let cachedClient: any = null;
let cachedUrl = '';
let cachedKey = '';

// Resilient auth storage adapter backed by AsyncStorage (native) and localStorage (web)
export const authStorageAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        return localStorage.getItem(key);
      }
      return await AsyncStorage.getItem(key);
    } catch (e) {
      console.warn('authStorageAdapter getItem error:', e);
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
      await AsyncStorage.setItem(key, value);
    } catch (e) {
      console.warn('authStorageAdapter setItem error:', e);
    }
  },
  removeItem: async (key: string): Promise<void> => {
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
      await AsyncStorage.removeItem(key);
    } catch (e) {
      console.warn('authStorageAdapter removeItem error:', e);
    }
  },
};

export function getSupabaseClient(url?: string, anonKey?: string) {
  let targetUrl = (url || DEFAULT_SUPABASE_URL).trim();
  const targetKey = (anonKey || DEFAULT_SUPABASE_ANON_KEY).trim();

  if (!targetUrl || !targetKey) {
    return null;
  }

  // Automatically prepend https:// if missing
  if (!/^https?:\/\//i.test(targetUrl)) {
    targetUrl = `https://${targetUrl}`;
  }

  if (cachedClient && cachedUrl === targetUrl && cachedKey === targetKey) {
    return cachedClient;
  }

  try {
    // Validate URL syntax
    new URL(targetUrl);

    cachedClient = createClient(targetUrl, targetKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: authStorageAdapter,
      },
    });
    cachedUrl = targetUrl;
    cachedKey = targetKey;
    return cachedClient;
  } catch (err) {
    return null;
  }
}

