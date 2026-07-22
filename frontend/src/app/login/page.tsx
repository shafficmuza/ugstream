import { fetchSettings } from '@/lib/settings';
import { LoginForm } from './login-form';

export default async function LoginPage() {
  const settings = await fetchSettings();
  const background = settings.authBackgroundUrl;

  return (
    <main
      className="auth-page"
      style={
        background
          ? { backgroundImage: `linear-gradient(rgba(11,11,15,0.55), rgba(11,11,15,0.85)), url(${background})` }
          : undefined
      }
    >
      <LoginForm />
    </main>
  );
}
