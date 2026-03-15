import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowRight, Brain, Code, Zap, Shield, Globe, Sparkles } from 'lucide-react';

function LandingLanguageSwitcher() {
  const { i18n } = useTranslation();
  const isEn = i18n.language.startsWith('en');
  return (
    <button
      type="button"
      onClick={() => i18n.changeLanguage(isEn ? 'zh-CN' : 'en')}
      className="text-gray-600 hover:text-gray-900"
    >
      {isEn ? '中文' : 'English'}
    </button>
  );
}

export function LandingPage() {
  const { t } = useTranslation();

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Header */}
      <header className="border-b bg-white/50 backdrop-blur-sm sticky top-0 z-50">
        <nav className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="w-8 h-8 text-blue-600" />
            <span className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              X-Computer
            </span>
          </div>
          <div className="hidden md:flex items-center gap-8">
            <a href="#features" className="text-gray-600 hover:text-gray-900">
              {t('landing.nav.features')}
            </a>
            <a href="#pricing" className="text-gray-600 hover:text-gray-900">
              {t('landing.nav.pricing')}
            </a>
            <a href="#about" className="text-gray-600 hover:text-gray-900">
              {t('landing.nav.about')}
            </a>
            <LandingLanguageSwitcher />
          </div>
          <div className="flex items-center gap-4">
            <Link to="/app" className="text-gray-600 hover:text-gray-900">
              {t('landing.nav.signIn')}
            </Link>
            <Link
              to="/app"
              className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
            >
              {t('landing.nav.getStarted')}
            </Link>
          </div>
        </nav>
      </header>

      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20 md:py-32">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-blue-50 text-blue-600 px-4 py-2 rounded-full text-sm font-medium mb-8">
            <Sparkles className="w-4 h-4" />
            {t('landing.hero.badge')}
          </div>
          <h1 className="text-5xl md:text-7xl font-bold mb-6 bg-gradient-to-r from-gray-900 via-blue-900 to-purple-900 bg-clip-text text-transparent">
            {t('landing.hero.title')}
            <br />
            {t('landing.hero.titleHighlight')}
          </h1>
          <p className="text-xl text-gray-600 mb-12 max-w-2xl mx-auto">
            {t('landing.hero.description')}
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/app"
              className="bg-blue-600 text-white px-8 py-4 rounded-lg hover:bg-blue-700 transition-colors text-lg font-semibold flex items-center justify-center gap-2"
            >
              {t('landing.hero.startTrial')}
              <ArrowRight className="w-5 h-5" />
            </Link>
            <a
              href="#features"
              className="border-2 border-gray-300 text-gray-700 px-8 py-4 rounded-lg hover:border-gray-400 transition-colors text-lg font-semibold"
            >
              {t('landing.hero.learnMore')}
            </a>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="container mx-auto px-6 py-20 bg-gray-50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            {t('landing.features.title')}
          </h2>
          <p className="text-xl text-gray-600 text-center mb-16">
            {t('landing.features.subtitle')}
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              { icon: Code, titleKey: 'landing.features.codeGeneration.title', descKey: 'landing.features.codeGeneration.description' },
              { icon: Globe, titleKey: 'landing.features.webBrowsing.title', descKey: 'landing.features.webBrowsing.description' },
              { icon: Zap, titleKey: 'landing.features.taskAutomation.title', descKey: 'landing.features.taskAutomation.description' },
              { icon: Shield, titleKey: 'landing.features.secureSandbox.title', descKey: 'landing.features.secureSandbox.description' },
              { icon: Brain, titleKey: 'landing.features.selfLearning.title', descKey: 'landing.features.selfLearning.description' },
              { icon: Sparkles, titleKey: 'landing.features.multiModal.title', descKey: 'landing.features.multiModal.description' },
            ].map(({ icon: Icon, titleKey, descKey }, index) => (
              <div
                key={index}
                className="bg-white p-8 rounded-xl shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-blue-600 mb-4">
                  <Icon className="w-8 h-8" />
                </div>
                <h3 className="text-xl font-semibold mb-2">{t(titleKey)}</h3>
                <p className="text-gray-600">{t(descKey)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing Section */}
      <section id="pricing" className="container mx-auto px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-4xl font-bold text-center mb-4">
            {t('landing.pricing.title')}
          </h2>
          <p className="text-xl text-gray-600 text-center mb-16">
            {t('landing.pricing.subtitle')}
          </p>
          <div className="grid md:grid-cols-3 gap-8">
            {(['trial', 'personal', 'pro'] as const).map((planKey, index) => {
              const isHighlighted = planKey === 'personal';
              const features = t('landing.pricing.features.' + planKey, { returnObjects: true }) as string[];
              return (
                <div
                  key={planKey}
                  className={`rounded-xl p-8 ${
                    isHighlighted
                      ? 'bg-blue-600 text-white shadow-xl scale-105'
                      : 'bg-white border-2 border-gray-200'
                  }`}
                >
                  <h3 className="text-2xl font-bold mb-2">
                    {t(`landing.pricing.${planKey}.name`)}
                  </h3>
                  <div className="mb-6">
                    <span className="text-4xl font-bold">
                      {t(`landing.pricing.${planKey}.price`)}
                    </span>
                    <span className={isHighlighted ? 'text-blue-100' : 'text-gray-600'}>
                      {' '}/ {t(`landing.pricing.${planKey}.period`)}
                    </span>
                  </div>
                  <ul className="space-y-3 mb-8">
                    {Array.isArray(features) &&
                      features.map((feature: string, i: number) => (
                        <li key={i} className="flex items-center gap-2">
                          <svg
                            className={`w-5 h-5 flex-shrink-0 ${isHighlighted ? 'text-blue-200' : 'text-green-500'}`}
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M5 13l4 4L19 7"
                            />
                          </svg>
                          {feature}
                        </li>
                      ))}
                  </ul>
                  <Link
                    to="/app"
                    className={`block text-center py-3 px-6 rounded-lg font-semibold transition-colors ${
                      isHighlighted
                        ? 'bg-white text-blue-600 hover:bg-gray-100'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {t(`landing.pricing.${planKey}.cta`)}
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* CTA Section */}
      <section className="container mx-auto px-6">
        <div className="max-w-6xl mx-auto">
          <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-3xl py-20 px-6 text-center text-white">
            <h2 className="text-4xl font-bold mb-6">
              {t('landing.cta.title')}
            </h2>
            <p className="text-xl mb-8 text-blue-100">
              {t('landing.cta.subtitle')}
            </p>
            <Link
              to="/app"
              className="inline-flex items-center gap-2 bg-white text-blue-600 px-8 py-4 rounded-lg hover:bg-gray-100 transition-colors text-lg font-semibold"
            >
              {t('landing.cta.button')}
              <ArrowRight className="w-5 h-5" />
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer id="about" className="border-t bg-gray-50 mt-20">
        <div className="container mx-auto px-6 py-12">
          <div className="grid md:grid-cols-4 gap-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <Brain className="w-6 h-6 text-blue-600" />
                <span className="text-xl font-bold">X-Computer</span>
              </div>
              <p className="text-gray-600 text-sm">
                {t('landing.footer.description')}
              </p>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t('landing.footer.product')}</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="#features" className="hover:text-gray-900">{t('landing.footer.features')}</a></li>
                <li><a href="#pricing" className="hover:text-gray-900">{t('landing.footer.pricing')}</a></li>
                <li><a href="#" className="hover:text-gray-900">{t('landing.footer.docs')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t('landing.footer.company')}</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="#about" className="hover:text-gray-900">{t('landing.footer.about')}</a></li>
                <li><a href="#" className="hover:text-gray-900">{t('landing.footer.blog')}</a></li>
                <li><a href="#" className="hover:text-gray-900">{t('landing.footer.contact')}</a></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold mb-4">{t('landing.footer.legal')}</h4>
              <ul className="space-y-2 text-sm text-gray-600">
                <li><a href="#" className="hover:text-gray-900">{t('landing.footer.privacy')}</a></li>
                <li><a href="#" className="hover:text-gray-900">{t('landing.footer.terms')}</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t mt-12 pt-8 text-center text-sm text-gray-600">
            {t('landing.footer.copyright')}
          </div>
        </div>
      </footer>
    </div>
  );
}
