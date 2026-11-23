import React from 'react';
import { Modal, Pressable, View } from 'react-native';
import { palette, radius, space } from '../theme/tokens';
import { Text } from './primitives';

/** Diálogo modal sencillo: título, contenido y acciones */
export function Dialog({ visible, title, onClose, children, actions }: {
  visible: boolean; title: string; onClose: () => void; children?: React.ReactNode; actions?: React.ReactNode;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable accessibilityLabel="Cerrar" onPress={onClose}
        style={{ flex: 1, backgroundColor: 'rgba(26,26,26,0.45)', alignItems: 'center', justifyContent: 'center', padding: space.lg }}>
        <Pressable accessibilityRole="none" onPress={() => {}}
          style={{ width: '100%', maxWidth: 420, backgroundColor: palette.surface, borderRadius: radius.xl, padding: space.lg, gap: space.md }}>
          <Text variant="heading" accessibilityRole="header">{title}</Text>
          {children}
          {actions ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: space.xs, flexWrap: 'wrap' }}>{actions}</View> : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
