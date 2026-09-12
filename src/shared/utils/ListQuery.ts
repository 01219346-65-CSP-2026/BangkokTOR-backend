export type ListQuery<TSort extends string = string> = {
  page: number;
  limit: number;
  sort?: TSort;
};