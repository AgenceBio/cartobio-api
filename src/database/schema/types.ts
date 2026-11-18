import { customType } from 'drizzle-orm/pg-core';

export const multiPolygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(MultiPolygon,4326)',
});

export const polygon = customType<{ data: string; driverData: string }>({
  dataType: () => 'geometry(Polygon,4326)',
});
