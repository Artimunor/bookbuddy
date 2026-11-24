import { deleteItemAsync, getItemAsync, setItemAsync, WHEN_UNLOCKED_THIS_DEVICE_ONLY } from "expo-secure-store";

const key = "bookbuddy.session.v1";
const options = { keychainAccessible: WHEN_UNLOCKED_THIS_DEVICE_ONLY };

export const sessionStorage = {
  read: () => getItemAsync(key, options),
  save: (value: string) => setItemAsync(key, value, options),
  remove: () => deleteItemAsync(key, options),
};
