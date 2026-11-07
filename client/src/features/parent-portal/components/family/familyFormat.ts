// One colour per child, used for their initials everywhere in the parent portal.
export const CHILD_FILLS = ['bg-tile-pink', 'bg-tile-blue', 'bg-tile-green', 'bg-tile-yellow', 'bg-tile-violet'];

export const formatUSD = (n: number) => `$${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
