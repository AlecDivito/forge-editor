import axios, { type AxiosError, type AxiosInstance, type InternalAxiosRequestConfig } from 'axios';
// import { Token } from './src/lib/generated';
import { CreateClientConfig } from './src/lib/generated/client';
import { apiOrigin } from '@/lib/transport';

// type RefreshableRequestConfig = InternalAxiosRequestConfig & {
//   _retry?: boolean;
//   skipAuthRefresh?: boolean;
// };

// const isBrowser = typeof window !== 'undefined';
// let refreshPromise: Promise<NonNullable<Token> | null> | null = null;

// const isAuthRoute = (config?: InternalAxiosRequestConfig) => {
//   const url = config?.url ?? '';
//   return url.includes('/api/auth/');
// };

// const setAuthorizationHeader = (instance: AxiosInstance, token: Token) => {
//   if (!token?.access_token) {
//     return;
//   }
//   instance.defaults.headers.common.Authorization = `Bearer ${token.access_token}`;
// };

// const getServerCookieHeader = async (): Promise<string | null> => {
//   try {
//     const { cookies } = await import('next/headers');
//     const cookieStore = await cookies();
//     const allCookies = cookieStore.getAll();
//     if (!allCookies.length) {
//       return null;
//     }
//     return allCookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');
//   } catch {
//     return null;
//   }
// };

// const attachServerCookies = async (config: RefreshableRequestConfig) => {
//   if (isBrowser) {
//     return config;
//   }

//   if (config.headers && 'Cookie' in config.headers) {
//     return config;
//   }

//   const cookieHeader = await getServerCookieHeader();
//   if (!cookieHeader) {
//     return config;
//   }

//   config.headers = {
//     ...(config.headers ?? {}),
//     Cookie: cookieHeader,
//     // eslint-disable-next-line @typescript-eslint/no-explicit-any
//   } as any;

//   return config;
// };

// const requestRefreshToken = async (instance: AxiosInstance): Promise<Token | null> => {
//   if (!refreshPromise) {
//     refreshPromise = instance
//       .post<Token>('/api/auth/token/refresh', undefined, {
//         headers: {
//           'Content-Type': 'application/json',
//         },
//         // @ts-expect-error custom flag for interceptors
//         skipAuthRefresh: true,
//         withCredentials: true,
//       })
//       .then((response) => response.data as NonNullable<Token>)
//       .catch(() => null)
//       .finally(() => {
//         refreshPromise = null;
//       });
//   }

//   return refreshPromise;
// };

const createAxiosInstance = () => {
  const instance = axios.create();

//   instance.interceptors.request.use(async (config) => {
//     const nextConfig = config as RefreshableRequestConfig;
//     if (isBrowser) {
//       nextConfig.withCredentials = true;
//       return nextConfig;
//     }

//     return attachServerCookies(nextConfig);
//   });

//   instance.interceptors.response.use(
//     (response) => response,
//     async (error: AxiosError) => {
//       const config = error.config as RefreshableRequestConfig | undefined;
//       if (!config) {
//         return Promise.reject(error);
//       }

//       if (config.skipAuthRefresh || config._retry) {
//         return Promise.reject(error);
//       }

//       if (error.response?.status !== 401) {
//         return Promise.reject(error);
//       }

//       if (isAuthRoute(config)) {
//         return Promise.reject(error);
//       }

//       config._retry = true;

//       const token = await requestRefreshToken(instance);
//       if (!token?.access_token) {
//         return Promise.reject(error);
//       }

//       setAuthorizationHeader(instance, token);
//       config.headers = {
//         ...(config.headers ?? {}),
//         Authorization: `Bearer ${token.access_token}`,
//       } as RefreshableRequestConfig['headers'];

//       return instance(config);
//     },
//   );

  return instance;
};

export const createClientConfig: CreateClientConfig = (config) => ({
  ...config,
  axios: createAxiosInstance(),
  baseURL: apiOrigin(),
});
