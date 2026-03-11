import { useState, useEffect, useCallback } from 'react';

/**
 * 自定义Hook，用于在localStorage中持久化状态
 * @param key localStorage的键名
 * @param defaultValue 默认值
 * @param options 配置选项
 * @returns [state, setState, clearState]
 */
export function useLocalStorageState<T>(
  key: string,
  defaultValue: T,
  options: {
    serialize?: (value: T) => string;
    deserialize?: (value: string) => T;
    clearOnUnmount?: boolean;
  } = {}
) {
  const {
    serialize = JSON.stringify,
    deserialize = JSON.parse,
    clearOnUnmount = false,
  } = options;

  // 从localStorage读取初始值
  const [state, setState] = useState<T>(() => {
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        return deserialize(item);
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return defaultValue;
  });

  // 保存状态到localStorage
  const setValue = useCallback(
    (value: T | ((prevValue: T) => T)) => {
      try {
        const valueToStore = value instanceof Function ? value(state) : value;
        setState(valueToStore);
        localStorage.setItem(key, serialize(valueToStore));
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error);
      }
    },
    [key, serialize, state]
  );

  // 清除状态
  const clearValue = useCallback(() => {
    try {
      localStorage.removeItem(key);
      setState(defaultValue);
    } catch (error) {
      console.warn(`Error removing localStorage key "${key}":`, error);
    }
  }, [key, defaultValue]);

  // 可选：在组件卸载时清除localStorage
  useEffect(() => {
    if (clearOnUnmount) {
      return () => {
        localStorage.removeItem(key);
      };
    }
  }, [key, clearOnUnmount]);

  return [state, setValue, clearValue] as const;
}
