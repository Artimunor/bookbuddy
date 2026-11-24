import { AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync } from "expo-secure-store";

const options = { keychainAccessible: AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };

export const localPreferenceStorage = {
  read: (key: string) => getItemAsync(key, options),
  write: (key: string, value: string) => setItemAsync(key, value, options),
  remove: (key: string) => deleteItemAsync(key, options),
};
