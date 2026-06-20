import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode, TuiStatus } from "../model/index.js";

export interface TopStatusLineProps {
  status: TuiStatus;
  width: number;
  colorMode: ColorMode;
}

export function TopStatusLine({
  status,
  width,
  colorMode
}: TopStatusLineProps): ReactElement {
  const showModel = width >= 100;
  const showTokens = width >= 120;
  const brandColor = colorMode === "none" ? undefined : "yellow";
  const mutedColor = colorMode === "none" ? undefined : "gray";
  const screenLabel = `alpha tui - ${status.screenTitle.toLowerCase()}`;
  const metadata = [
    showModel && status.modelLabel !== undefined
      ? `model ${status.modelLabel}`
      : undefined,
    showTokens ? status.tokenLabel : undefined,
    status.permissionMode === undefined
      ? undefined
      : status.permissionMode
  ].filter(isPresent);

  return (
    <Box
      justifyContent="space-between"
      marginBottom={1}
      width={Math.max(40, width - 2)}
    >
      <Box>
        <Text {...textColor(brandColor)} bold>
          {status.productName}
        </Text>
        <Text>  {screenLabel}</Text>
      </Box>
      {metadata.length > 0 ? (
        <Text {...textColor(mutedColor)}>{metadata.join(" - ")}</Text>
      ) : null}
    </Box>
  );
}

function isPresent(value: string | undefined): value is string {
  return value !== undefined && value.length > 0;
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
