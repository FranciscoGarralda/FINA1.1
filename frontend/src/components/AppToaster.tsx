import { Toaster } from 'sonner';
import { useTheme } from '../context/ThemeContext';

export default function AppToaster() {
  const { theme } = useTheme();
  return (
    <Toaster
      theme={theme}
      richColors
      position="top-center"
      closeButton
      toastOptions={{ duration: 5000 }}
    />
  );
}
