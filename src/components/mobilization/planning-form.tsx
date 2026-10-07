import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { Type } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";

/** Plain, labelled inputs shared by the response-rule and observation forms. */
export function PlanningField({
  label,
  value,
  onChange,
  multiline = false,
  numeric = false,
  disabled = false,
  hint,
  autoCapitalize = "sentences",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  numeric?: boolean;
  disabled?: boolean;
  hint?: string;
  autoCapitalize?: "none" | "sentences";
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      {hint && <Text style={[styles.small, { color: theme.textSecondary }]}>{hint}</Text>}
      <TextInput
        accessibilityLabel={label}
        accessibilityHint={hint}
        value={value}
        onChangeText={onChange}
        editable={!disabled}
        multiline={multiline}
        inputMode={numeric ? "decimal" : "text"}
        autoCapitalize={autoCapitalize}
        style={[
          styles.input,
          multiline && styles.multiline,
          {
            color: theme.text,
            borderColor: theme.border,
            backgroundColor: disabled ? theme.backgroundElement : theme.background,
          },
        ]}
      />
    </View>
  );
}

/** A short native choice group. Every option remains a mobile-size tap target. */
export function PlanningChoice({
  label,
  value,
  choices,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  choices: { value: string; label: string }[];
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: theme.text }]}>{label}</Text>
      <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.choices}>
        {choices.map((choice) => (
          <Pressable
            key={choice.value}
            accessibilityRole="radio"
            accessibilityLabel={`${label}: ${choice.label}`}
            accessibilityState={{ checked: value === choice.value, disabled }}
            aria-checked={value === choice.value}
            disabled={disabled}
            onPress={() => onChange(choice.value)}
            style={[
              styles.choice,
              {
                borderColor: value === choice.value ? theme.tint : theme.border,
                backgroundColor:
                  value === choice.value ? theme.backgroundSelected : theme.background,
              },
            ]}
          >
            <Text
              style={[styles.body, { color: value === choice.value ? theme.tint : theme.text }]}
            >
              {choice.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  field: { gap: 7 },
  label: { fontSize: Type.callout, fontWeight: "600" },
  small: { fontSize: Type.footnote, lineHeight: 18 },
  body: { fontSize: Type.callout, lineHeight: 20 },
  input: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: Type.body,
  },
  multiline: { minHeight: 88, textAlignVertical: "top" },
  choices: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  choice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 11,
    justifyContent: "center",
  },
});
