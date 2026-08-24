import Header from "@/components/Header";
import Hero from "@/components/Hero";
import AppsShowcase from "@/components/AppsShowcase";
import Contact from "@/components/Contact";
import Footer from "@/components/Footer";

export default function Home() {
  return (
    <>
      <Header />
      <main>
        <Hero />
        <AppsShowcase />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
