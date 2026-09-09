export type PageResult<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
};