import { Box, Text } from "ink";
import type { ReactElement } from "react";
import type { ColorMode } from "../model/index.js";
import { TuiFrame } from "./TuiFrame.js";

export interface WelcomeBannerProps {
  colorMode: ColorMode;
  width?: number | undefined;
}

export function WelcomeBanner({
  colorMode,
  width = 96
}: WelcomeBannerProps): ReactElement {
  const brandColor = colorMode === "none" ? undefined : "yellow";
  const accentColor = colorMode === "none" ? undefined : "cyan";

  return (
    <TuiFrame
      colorMode={colorMode}
      marginTop={1}
      maxWidth={76}
      paddingX={2}
      tone="accent"
      width={width}
    >
      <Box>
        <Text {...textColor(brandColor)} bold>
          * Welcome to OpenHarness
        </Text>
      </Box>
      <Box>
        <Text {...textColor(accentColor)}>/help</Text>
        <Text> for help, </Text>
        <Text {...textColor(accentColor)}>/status</Text>
        <Text> for current setup</Text>
      </Box>
    </TuiFrame>
  );
}

function textColor<TColor extends string>(
  color: TColor | undefined
): { color: TColor } | Record<string, never> {
  return color === undefined ? {} : { color };
}
